import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";

// Self-test for scripts/restore-fixture.mjs — the synthetic whole-stack
// restore fixture for chat state (SQLite rows/schema, encrypted keys,
// password digests, avatar/branding bytes). The CLI is exercised as a real
// child process (`node scripts/restore-fixture.mjs ...`); every expectation
// here is defined INDEPENDENTLY in this file (its own key derivation, its own
// AES-256-GCM envelope decrypt, its own SHA-256 and row constants) so the
// oracle never trusts the script's own verify output for the baseline.

const REPO_ROOT = process.cwd();
const SCRIPT = resolve(REPO_ROOT, "scripts/restore-fixture.mjs");
const SENTINEL = "restore-fixture.sentinel.json";

// Independent fixture constants (must mirror the script's synthetic literals).
const FIXTURE_KEY = Buffer.alloc(32);
Buffer.from("synthetic-restore-fixture-key", "utf8").copy(FIXTURE_KEY);
const READ_KEY_PLAINTEXT = "fx-synthetic-backend-read-key-0001";
const USER_PASSWORD = "fx-correct-horse-battery-staple";

// Independent fixture-pack v2 citation constants (mirrored, authoritative in
// scripts/restore-fixture.mjs): the restored citation must carry the full
// public-Source shape and the chunk-0 excerpt verbatim.
const FX_DOCUMENT_ID = "fx-source-0001";
const FX_FILENAME = "fixture-source.md";
// Accepted MAIN producer declaration, pinned verbatim (coherence check: the
// chat side must equal this fixed text — no silent template copy).
const FX_ACCEPTED_TEXT =
  "Fixture Source content for the disposable restore rehearsal.\n" +
  "It's a \"test\" with escaping: back\\slash and 'quotes'.\n" +
  "The fixture graph cites this document as fx-source-0001 (Fixture Source).\n" +
  "Mentions Rehearsal Alpha and Rehearsal Beta for graph linkage.\n";
const AVATAR_SHA256 = sha256(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  )
);
const BRANDING_SHA256 = sha256(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
    "base64"
  )
);

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

let workDir: string;

before(() => {
  workDir = mkdtempSync(join(tmpdir(), "cortex-chat-restore-fixture-"));
});

after(() => {
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    // temp cleanup is best-effort
  }
});

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[]): CliResult {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function jsonOk(res: CliResult): any {
  assert.equal(res.status, 0, `expected exit 0, stderr: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function jsonFailed(res: CliResult): { stdout: any; stderr: any } {
  assert.equal(res.status, 1, `expected exit 1, stdout: ${res.stdout}`);
  const out: { stdout: any; stderr: any } = { stdout: null, stderr: null };
  try {
    out.stdout = JSON.parse(res.stdout);
  } catch {
    out.stdout = null;
  }
  try {
    out.stderr = JSON.parse(res.stderr);
  } catch {
    out.stderr = null;
  }
  return out;
}

function copyFixture(from: string, to: string): void {
  cpSync(from, to, { recursive: true });
}

// Independent AES-256-GCM envelope decrypt (base64: 12-byte IV | ct | 16-byte
// tag) — deliberately NOT the src implementation, so a script bug cannot hide
// behind the oracle.
function decryptEnvelope(envelopeB64: string, key: Buffer): string {
  const buf = Buffer.from(envelopeB64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(buf.length - 16));
  return Buffer.concat([
    decipher.update(buf.subarray(12, buf.length - 16)),
    decipher.final(),
  ]).toString("utf8");
}

function openDb(dir: string): Database.Database {
  return new Database(join(dir, "cortex-chat.db"), {
    fileMustExist: true,
  });
}

// The one seeded fixture reused by most tests.
let fixtureDir: string;

test("seed creates a quiesced fixture; verify passes on the source", () => {
  fixtureDir = join(workDir, "seeded");
  const seed = jsonOk(runCli(["seed", fixtureDir]));
  assert.equal(seed.ok, true);
  assert.equal(seed.quiesced, true, "no WAL/SHM remnants after seed");

  // Exact volume-root file set (the directory IS the mounted /app/data
  // volume: cortex-chat.db + avatars/ + branding/ + sentinel, nothing else).
  assert.deepEqual(readdirSync(fixtureDir).sort(), [
    "avatars",
    "branding",
    "cortex-chat.db",
    SENTINEL,
  ]);
  assert.deepEqual(
    readdirSync(join(fixtureDir, "avatars")).sort(),
    ["fx-user-0001.png"]
  );
  assert.deepEqual(readdirSync(join(fixtureDir, "branding")), [
    "logo.png",
  ]);

  const verify = jsonOk(runCli(["verify", fixtureDir]));
  assert.equal(verify.ok, true);
  assert.deepEqual(verify.failures, []);
  // Fixture pack v2 (full public-Source citation metadata).
  const sentinel = JSON.parse(readFileSync(join(fixtureDir, SENTINEL), "utf8"));
  assert.equal(sentinel.fixtureVersion, 2);
});

test("independent baseline oracle: bytes, rows, decrypted key and password digest", () => {
  const sqlite = openDb(fixtureDir);
  try {
    // Asset bytes match the test's own SHA-256 constants.
    assert.equal(
      sha256(readFileSync(join(fixtureDir, "avatars/fx-user-0001.png"))),
      AVATAR_SHA256
    );
    assert.equal(
      sha256(readFileSync(join(fixtureDir, "branding/logo.png"))),
      BRANDING_SHA256
    );

    const users = sqlite
      .prepare("SELECT * FROM users ORDER BY id")
      .all() as any[];
    assert.deepEqual(
      users.map((u) => [u.id, u.email, u.username, u.role]),
      [
        ["fx-user-0001", "fixture-user-0001@example.invalid", "fixture-admin", "admin"],
        ["fx-user-0002", "fixture-user-0002@example.invalid", "fixture-user", "user"],
      ]
    );
    assert.equal(users[0].avatar_path, "fx-user-0001.png");
    assert.ok(
      users[0].password_hash.startsWith("$argon2id$"),
      "digest comes from the real argon2id password module"
    );

    const group = sqlite.prepare("SELECT * FROM groups").get() as any;
    assert.equal(group.id, "fx-group-0001");
    assert.equal(group.chat_key_id, "fx-key-read-0001");

    const keys = sqlite
      .prepare("SELECT * FROM api_keys ORDER BY id")
      .all() as any[];
    assert.deepEqual(
      keys.map((k) => [k.id, k.permission, k.backend_key_id]),
      [
        ["fx-key-content-0002", "manage", "fx-backend-key-0002"],
        ["fx-key-read-0001", "read", "fx-backend-key-0001"],
      ]
    );
    // Independent decrypt of the read key envelope.
    const readRow = keys.find((k) => k.id === "fx-key-read-0001");
    assert.equal(
      decryptEnvelope(readRow.encrypted_value, FIXTURE_KEY),
      READ_KEY_PLAINTEXT
    );

    const chat = sqlite.prepare("SELECT * FROM chat_sessions").get() as any;
    assert.equal(chat.id, "fx-chat-0001");
    assert.equal(
      chat.memory,
      JSON.stringify({ conversation_memory: "fx-opaque-blob-v1", turns: 2 }),
      "opaque memory blob stored verbatim"
    );
    assert.equal(chat.pinned, 1);
    assert.equal(chat.project_id, "fx-project-0001");
    assert.equal(chat.assistant_id, "fx-soul-0001");

    const messages = sqlite
      .prepare("SELECT id, role, user_id FROM chat_messages ORDER BY rowid")
      .all() as any[];
    assert.deepEqual(messages, [
      { id: "fx-msg-0001", role: "user", user_id: "fx-user-0001" },
      { id: "fx-msg-0002", role: "assistant", user_id: null },
      { id: "fx-msg-0003", role: "user", user_id: "fx-user-0001" },
      { id: "fx-msg-0004", role: "assistant", user_id: null },
    ]);

    // Fixture pack v2: the citation in fx-msg-0002 carries the full public
    // Source shape with the chunk-0 excerpt verbatim (independent oracle).
    const citeMeta = JSON.parse(
      (sqlite.prepare("SELECT metadata FROM chat_messages WHERE id = 'fx-msg-0002'").get() as any)
        .metadata
    );
    assert.deepEqual(citeMeta.sources, [
      {
        document_id: FX_DOCUMENT_ID,
        chunk_id: `${FX_DOCUMENT_ID}-chunk-0`,
        content: FX_ACCEPTED_TEXT,
        score: 0.42,
        sid: "fx-source-0001",
        title: "Fixture Source",
        metadata: { filename: FX_FILENAME, chunk_index: 0 },
      },
    ]);
    // Accepted producer cardinality: exactly ONE markdown chunk; the UI's
    // "\n\n" join of it is the text itself — the app/oracle snapshot must
    // reproduce this verbatim (cross-repo consistency check owned by main).
    assert.equal(citeMeta.sources.length, 1);
    // Escaping coherence: the accepted declaration carries a literal
    // backslash (back\slash) — pinned so no template copy silently
    // normalizes it away.
    assert.ok(FX_ACCEPTED_TEXT.includes("back\\slash"));

    const session = sqlite.prepare("SELECT * FROM sessions").get() as any;
    assert.equal(session.user_id, "fx-user-0001");
    assert.ok(String(session.token).length > 20, "opaque session token present");

    const settings = sqlite
      .prepare("SELECT key, value FROM app_settings ORDER BY key")
      .all() as any[];
    assert.deepEqual(settings, [
      { key: "appTitle", value: "Restore Fixture Chat" },
      { key: "logoFile", value: "logo.png" },
      // logoUpdatedAt stores the string form of its own timestamp.
      { key: "logoUpdatedAt", value: "1767225606000" },
    ]);

    // Remap property: no absolute reference to the fixture directory anywhere.
    for (const table of [
      "api_keys", "groups", "users", "sessions", "login_events", "assistants",
      "projects", "project_shares", "chat_sessions", "chat_messages",
      "app_settings",
    ]) {
      for (const row of sqlite.prepare(`SELECT * FROM ${table}`).all() as any[]) {
        for (const value of Object.values(row)) {
          assert.ok(
            !(typeof value === "string" && value.includes(fixtureDir)),
            `absolute path leaked in ${table}`
          );
        }
      }
    }

    // Real Drizzle journal: all 11 migrations applied.
    const journal = sqlite
      .prepare("SELECT COUNT(*) AS n FROM __drizzle_migrations")
      .get() as any;
    assert.equal(journal.n, 11);
  } finally {
    sqlite.close();
  }
});

test("fixture remaps: a plain copied target verifies at the new location; verify writes nothing", () => {
  const target = join(workDir, "remapped-copy");
  copyFixture(fixtureDir, target);
  const sentinel = JSON.parse(readFileSync(join(target, SENTINEL), "utf8"));
  assert.ok(
    !JSON.stringify(sentinel).includes(workDir),
    "sentinel must not embed absolute paths"
  );
  const dbBytesBefore = readFileSync(join(target, "cortex-chat.db"));
  const verify = jsonOk(runCli(["verify", target]));
  assert.equal(verify.ok, true);
  assert.deepEqual(verify.failures, []);
  // Read-only verification: identical DB bytes, unchanged file set, no
  // transient WAL/SHM left behind.
  assert.ok(
    dbBytesBefore.equals(readFileSync(join(target, "cortex-chat.db"))),
    "verify must not modify the artifact bytes"
  );
  assert.deepEqual(readdirSync(target).sort(), [
    "avatars",
    "branding",
    "cortex-chat.db",
    SENTINEL,
  ]);
});

test("negative control: deleted avatar asset fails verification", () => {
  const dir = join(workDir, "missing-avatar");
  copyFixture(fixtureDir, dir);
  rmSync(join(dir, "avatars/fx-user-0001.png"));
  const { stdout } = jsonFailed(runCli(["verify", dir]));
  assert.equal(stdout.ok, false);
  assert.ok(
    stdout.failures.some((f: string) => f.includes("fx-user-0001.png")),
    `failure must name the missing asset: ${JSON.stringify(stdout.failures)}`
  );
});

test("negative control: corrupted avatar bytes fail verification (fixed constant oracle)", () => {
  const dir = join(workDir, "corrupt-avatar");
  copyFixture(fixtureDir, dir);
  // Corrupt the asset but keep it present — transport/size unchanged.
  const avatar = readFileSync(join(dir, "avatars/fx-user-0001.png"));
  avatar[avatar.length - 1] ^= 0xff;
  writeFileSync(join(dir, "avatars/fx-user-0001.png"), avatar);
  const { stdout } = jsonFailed(runCli(["verify", dir]));
  assert.equal(stdout.ok, false);
  assert.ok(
    stdout.failures.some(
      (f: string) =>
        f.includes("fx-user-0001.png") && f.includes("sha256"),
    ),
    `failure must name the corrupted asset digest: ${JSON.stringify(stdout.failures)}`
  );
});

test("negative control: forged sentinel asset digest is rejected (sentinel is not the oracle)", () => {
  const dir = join(workDir, "forged-sentinel");
  copyFixture(fixtureDir, dir);
  // Corrupt the asset AND forge the sentinel digest to match the corruption:
  // a sentinel-trusting verifier would accept the damaged file.
  const avatar = readFileSync(join(dir, "avatars/fx-user-0001.png"));
  avatar[avatar.length - 1] ^= 0xff;
  writeFileSync(join(dir, "avatars/fx-user-0001.png"), avatar);
  const sentinel = JSON.parse(readFileSync(join(dir, SENTINEL), "utf8"));
  sentinel.assets[0].sha256 = sha256(avatar); // forged to bless the corruption
  writeFileSync(join(dir, SENTINEL), JSON.stringify(sentinel, null, 2));
  const { stdout } = jsonFailed(runCli(["verify", dir]));
  assert.equal(stdout.ok, false);
  assert.ok(
    stdout.failures.some((f: string) => f.startsWith("sentinel:")),
    `forged sentinel must be rejected as a failure: ${JSON.stringify(stdout.failures)}`
  );
  // The fixed-constant asset oracle still rejects the corrupted bytes.
  assert.ok(
    stdout.failures.some(
      (f: string) => f.includes("fx-user-0001.png") && f.includes("sha256")
    ),
    `asset oracle stays independent of the forged sentinel: ${JSON.stringify(stdout.failures)}`
  );
});

test("negative control: removing a sentinel asset entry is rejected; deleting the file too still fails", () => {
  // (a) Strip the avatar entry from the sentinel but keep the file — the
  // fixed expectation still demands the asset, so the stripped sentinel fails.
  const stripped = join(workDir, "stripped-sentinel");
  copyFixture(fixtureDir, stripped);
  const sentinel = JSON.parse(readFileSync(join(stripped, SENTINEL), "utf8"));
  sentinel.assets = sentinel.assets.filter(
    (a: any) => !a.path.includes("fx-user-0001")
  );
  writeFileSync(join(stripped, SENTINEL), JSON.stringify(sentinel, null, 2));
  const failA = jsonFailed(runCli(["verify", stripped]));
  assert.equal(failA.stdout.ok, false);
  assert.ok(
    failA.stdout.failures.some((f: string) => f.startsWith("sentinel:")),
    "stripped sentinel entry must be rejected"
  );

  // (b) Delete the avatar AND strip its sentinel entry — the asset must STILL
  // fail verification from the fixed constant expectation alone.
  const strippedDeleted = join(workDir, "stripped-sentinel-deleted");
  copyFixture(fixtureDir, strippedDeleted);
  const sentinel2 = JSON.parse(
    readFileSync(join(strippedDeleted, SENTINEL), "utf8")
  );
  sentinel2.assets = sentinel2.assets.filter(
    (a: any) => !a.path.includes("fx-user-0001")
  );
  writeFileSync(join(strippedDeleted, SENTINEL), JSON.stringify(sentinel2, null, 2));
  rmSync(join(strippedDeleted, "avatars/fx-user-0001.png"));
  const failB = jsonFailed(runCli(["verify", strippedDeleted]));
  assert.equal(failB.stdout.ok, false);
  assert.ok(
    failB.stdout.failures.some(
      (f: string) => f.includes("fx-user-0001.png") && f.includes("missing")
    ),
    `deleted asset must fail even when the sentinel entry is gone: ${JSON.stringify(failB.stdout.failures)}`
  );
});

test("negative control: wrong encryption key fails verification", async () => {
  const dir = join(workDir, "wrong-key");
  copyFixture(fixtureDir, dir);
  // Re-encrypt the same plaintext under a DIFFERENT key in the copy — the
  // fixture key no longer recovers it, like a lost/changed APP_ENCRYPTION_KEY.
  const sqlite = openDb(dir);
  const wrong = Buffer.alloc(32, 0xaa);
  const iv = Buffer.alloc(12, 1);
  const enc = createCipheriv("aes-256-gcm", wrong, iv);
  const ct = Buffer.concat([enc.update(READ_KEY_PLAINTEXT, "utf8"), enc.final()]);
  const envelope = Buffer.concat([iv, ct, enc.getAuthTag()]).toString("base64");
  sqlite
    .prepare("UPDATE api_keys SET encrypted_value = ? WHERE id = 'fx-key-read-0001'")
    .run(envelope);
  sqlite.close();

  const { stdout } = jsonFailed(await Promise.resolve(runCli(["verify", dir])));
  assert.equal(stdout.ok, false);
  assert.ok(
    stdout.failures.some((f: string) => f.includes("fx-key-read-0001") && f.includes("decrypt")),
    `failure must name the undecryptable key: ${JSON.stringify(stdout.failures)}`
  );
});

test("negative control: a missing chat message fails verification", () => {
  const dir = join(workDir, "missing-message");
  copyFixture(fixtureDir, dir);
  const sqlite = openDb(dir);
  sqlite.prepare("DELETE FROM chat_messages WHERE id = 'fx-msg-0002'").run();
  sqlite.close();
  const { stdout } = jsonFailed(runCli(["verify", dir]));
  assert.equal(stdout.ok, false);
  assert.ok(
    stdout.failures.some((f: string) => f.includes("fx-msg-0002") || f.includes("chat_messages")),
    `failure must name the dropped message: ${JSON.stringify(stdout.failures)}`
  );
});

test("mutate marks the source; the frozen baseline target still passes and lacks canaries", () => {
  const frozen = join(workDir, "frozen");
  copyFixture(fixtureDir, frozen);

  const mutate = jsonOk(runCli(["mutate", fixtureDir]));
  assert.equal(mutate.ok, true);
  assert.deepEqual(mutate.canaries.message, "fx-msg-canary-0005");

  // Mutated source must FAIL the frozen-baseline verifier...
  const { stdout } = jsonFailed(runCli(["verify", fixtureDir]));
  assert.equal(stdout.ok, false);
  for (const marker of ["fx-msg-canary-0005", "fx-usage-canary-0001", "fx-canary-0001.png"]) {
    assert.ok(
      JSON.stringify(stdout.failures).includes(marker),
      `verifier must reject canary ${marker}: ${JSON.stringify(stdout.failures)}`
    );
  }

  // ...while the frozen pre-mutation copy still passes.
  const verify = jsonOk(runCli(["verify", frozen]));
  assert.equal(verify.ok, true);

  // Independent absence check on the frozen target (what the restore harness
  // will assert for post-snapshot writes): no canary rows, no canary file.
  const sqlite = openDb(frozen);
  try {
    assert.equal(
      (sqlite.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE id = 'fx-msg-canary-0005'").get() as any).n,
      0
    );
    assert.equal(
      (sqlite.prepare("SELECT COUNT(*) AS n FROM usage_events").get() as any).n,
      0
    );
    const chat = sqlite.prepare("SELECT memory FROM chat_sessions WHERE id = 'fx-chat-0001'").get() as any;
    assert.equal(chat.memory, JSON.stringify({ conversation_memory: "fx-opaque-blob-v1", turns: 2 }));
  } finally {
    sqlite.close();
  }
  assert.ok(!existsSync(join(frozen, "avatars/fx-canary-0001.png")));

  // And the mutated source does contain them (independent presence check).
  const mutated = openDb(fixtureDir);
  try {
    assert.equal(
      (mutated.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE id = 'fx-msg-canary-0005'").get() as any).n,
      1
    );
    assert.equal(
      (mutated.prepare("SELECT COUNT(*) AS n FROM usage_events WHERE id = 'fx-usage-canary-0001'").get() as any).n,
      1
    );
  } finally {
    mutated.close();
  }
});

test("gate refusals: bad usage exits 2; seed refuses dirty targets; verify/mutate require the sentinel", () => {
  const usage = spawnSync(process.execPath, [SCRIPT], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(usage.status, 2, "missing args must exit 2 with usage");
  assert.match(usage.stderr ?? "", /usage:/);

  const nonEmpty = join(workDir, "non-empty");
  mkdirSync(nonEmpty, { recursive: true });
  writeFileSync(join(nonEmpty, "stray-file.txt"), "x");
  const { stderr } = jsonFailed(runCli(["seed", nonEmpty]));
  assert.match(String(stderr?.error ?? stderr), /non-empty|refuses/);

  const empty = join(workDir, "empty-dir");
  const vFail = jsonFailed(runCli(["verify", empty]));
  assert.match(String(vFail.stderr?.error ?? vFail.stderr), /sentinel/);
  const mutFail = jsonFailed(runCli(["mutate", empty]));
  assert.match(String(mutFail.stderr?.error ?? mutFail.stderr), /sentinel/);
});
