# Record: synthetic restore fixture for chat state — 2026-10-01

Work package: a small executable synthetic state fixture that lets the actual
whole-stack backup/restore rehearsal exercise the **chat** state surface
(SQLite rows/schema, encrypted API keys, password digests, login session,
personality/project/grants, opaque memory, avatar/branding bytes) — without
touching runtime source, dependencies, migrations or deployment configuration.

- Repository: cortex-chat @ `40fe79799c4729c4b695890566ef3a51746b3b5e` (v1.3.0)
  with the preceding adoption slice uncommitted; all of it preserved untouched
  (`git status` before/after shows only this slice's three new files).
- Playbook: `../cortex-app/REGENERATIVE-SOFTWARE.md`; protocol context:
  `../cortex-app/.claude/upgrade-recovery.md` § Disposable restore-verification
  protocol (steps 1 and 3: freeze the fixture, then exercise post-snapshot
  writes with retained exclusion assertions).
- Ownership: writes confined to `scripts/restore-fixture.mjs` (new),
  `tests/restore-fixture.test.ts` (new), this record. Root `CLAUDE.md`,
  `docs/regeneration/index.md`, guides and `src/` untouched (lead owns
  integration).
- Evidence scope (read this before citing): **state-level only**. This fixture
  proves rows/schema/bytes/decryption survive a copy/restore. It does **not**
  exercise a chat login, a browser journey, or the running server, and none of
  that may be claimed from passing it. A companion harness that reads this
  database directly must not describe that as "chat login tested" — it is a
  database-row comparison; the recipe and its limits are below.

## What changed

### 1. `scripts/restore-fixture.mjs` (new) — CLI

```
node scripts/restore-fixture.mjs seed   <directory>
node scripts/restore-fixture.mjs verify <directory>
node scripts/restore-fixture.mjs mutate <directory>
```

- **Exit-code contract:** success 0; content/gate failures 1; bad usage 2.
  `verify` prints its result JSON on stdout
  (`{"ok":bool,"failures":[...],"checked":{...}}`). Refusals (non-empty seed
  target, missing/unreadable sentinel, key-fingerprint mismatch, missing DB)
  print `{"ok":false,"error":"..."}` on **stderr** and exit 1.
- **Real machinery, no app boot:** the parent process re-execs itself via
  `node --import tsx --conditions=react-server` (same loader flags as the
  contract suite) so the repo's **real** modules load: `src/lib/auth/crypto.ts`
  (`encryptSecret`/`decryptSecret`, AES-256-GCM) and `src/lib/auth/password.ts`
  (`hashPassword`/`verifyPassword`, argon2id), plus the **real Drizzle
  migrator** (`drizzle-orm/better-sqlite3/migrator`) over the repository's
  actual migration journal `src/lib/db/migrations/` (0000–0010, 11 entries).
  No app boot, no DB singleton and no route code is imported
  (`src/lib/db/client.ts` stays untouched — the script opens its own
  connection with the same pragmas, WAL + foreign_keys ON); the retained
  runtime dependencies are exactly those three, explicit in the header.
  The synthetic key/password come from the script's own constants — no env
  lookup, no provider.
- **Volume-root layout (matches the actual mounted `/app/data`):** the target
  directory IS the data volume root — `<dir>/cortex-chat.db`,
  `<dir>/avatars/`, `<dir>/branding/`, sentinel `<dir>/restore-fixture.sentinel.json`.
  No nested `data/` layer. The main restore harness therefore captures the
  exact `cortex-chat.db` file (plus `avatars/`, `branding/`) for source and
  target — not a `.sqlite` glob.
- **Everything synthetic and hardcoded:** IDs are `fx-*`, emails
  `*@example.invalid`, IP `192.0.2.x` (documentation ranges), and the
  `APP_ENCRYPTION_KEY` is 32 bytes derived from the literal
  `"synthetic-restore-fixture-key"` (fingerprint recorded in the sentinel).
  The child environment strips ambient `DATABASE_PATH`, `APP_ENCRYPTION_KEY`,
  `CORTEX_API_URL`, `BACKEND_ADMIN_API_KEY`, `SUPERADMIN_*`, `SMTP_*`,
  `OIDC_*`, `DEMO_MODE`, `SENTRY_DSN` and re-sets the key unconditionally — no
  ambient state, no key/password provider, no services, no network calls.
- **Seed** (refuses an existing DB or a non-empty target): migrates a fresh
  `cortex-chat.db` at the volume root, then inserts one group, two users (one
  with avatar + content key), one read key + one manage/content key (encrypted
  with the real `encryptSecret`), one login session, one login event, one
  global soul, one project with a group share and a user share (grants), one
  chat with an opaque memory blob and 4 messages (with per-message authorship
  incl. one null-authored assistant message and source metadata), three
  `app_settings` rows (`appTitle`, `logoFile`, `logoUpdatedAt` — branding
  linked to the file), plus `avatars/fx-user-0001.png` and
  `branding/logo.png`. All timestamps are fixed (epoch `1767225600000` +
  offsets) so rows are deterministic. It writes
  `restore-fixture.sentinel.json` (relative paths only: DB path, IDs, key
  fingerprint, per-asset SHA-256 — exactly the script's fixed expectation),
  checkpoints (`wal_checkpoint(TRUNCATE)`) and closes the DB — clean close
  removes `-wal`/`-shm`, so the fixture is **quiesced**.
- **Relative references:** `avatar_path` stores a bare filename; sentinel
  paths are relative (`cortex-chat.db`, `avatars/fx-user-0001.png`,
  `branding/logo.png`); `verify` additionally fails if any DB cell contains
  the target's absolute directory path. A plain `cp -a` of a seeded fixture
  verifies at the new location (self-tested).
- **verify is read-only and judges with fixed expectations only:**
  - Opens the database **read-only** (`readonly` + `fileMustExist`, no
    pragmas, no checkpoint) — the restored artifact is never written.
    SQLite transiently creates empty `-wal`/`-shm` sidecars even for
    read-only connections on a WAL-mode database; verify requires **no
    sidecars before open** (a sidecar present at open is a quiesce failure,
    left in place for forensics), removes only the sidecars it created
    itself, and leaves the artifact's file set unchanged (self-tested:
    identical DB bytes before/after).
  - The **sentinel is metadata, never the oracle**: after the
    missing/unreadable/kind/fingerprint refusals, the sentinel content must
    structurally equal the fixed expectation built into the script (kind,
    version, `dbPath`, IDs, key fingerprint, declared assets). A forged
    digest, a removed/added asset entry, or changed IDs/dbPath is rejected as
    a named failure — and `mutate` refuses to write into a tampered fixture.
  - The **asset oracle is the hardcoded `AVATAR_PNG`/`BRANDING_PNG`
    constants**: exact file sets in `avatars/` and `branding/`, SHA-256 per
    file against the constants. Missing files, corrupted bytes, extra canary
    blobs and forged/stripped sentinel entries all fail with named failures,
    regardless of what the sentinel declares.
  - Exact table-name set (14 app tables + `__drizzle_migrations`; unexpected
    or missing tables fail — the main harness's full SQLite diff stays the
    independent backstop, this keeps the helper self-sufficient), exact
    column-name schema per table (order matters — it records the migration
    history; ALTERed columns appear last: `oidc_*`, `method`,
    `memory/pinned/assistant_id/project_id`, `chat_messages.user_id`),
    11-entry `__drizzle_migrations`, exact row sets for all 11 seeded tables
    (19 rows; extra/stale/missing rows fail and are named), three tables
    required empty (`registrations`, `password_reset_tokens`,
    `usage_events` — catches canary rows), decryption of both keys via the
    real `decryptSecret` (envelope not byte-compared — IVs are random by
    design), argon2 password verification via the real `verifyPassword`, and
    no absolute-path leak in any DB cell. No loose normalization: every field
    is compared; failures name table, row and field.
- **mutate** requires the sentinel (matching the fixed expectation) + all
  expected synthetic IDs (incl. the content key and all four messages)
  **before any effect**, then appends post-snapshot canaries while preserving
  every fixture ID: extra chat message `fx-msg-canary-0005`, mutated
  `chat_sessions.memory` (canary blob), extra `usage_events` row
  `fx-usage-canary-0001`, extra avatar blob `avatars/fx-canary-0001.png`. The
  frozen-baseline verifier must reject the mutated source, and the restore
  harness asserts these canaries are **absent** from the restored target.

### 2. `tests/restore-fixture.test.ts` (new) — self-test (11 tests)

Runs under the existing runner (`scripts/run-tests.mjs` picks the file up
automatically by directory listing; same `tsx` + `react-server` flags; tiny
temp-fs workspaces under the OS temp dir; no runtime imports). It spawns the
real CLI as a child process and defines every expectation **independently**
in the test (its own key derivation, its own AES-256-GCM envelope decrypt via
`node:crypto`, its own SHA-256 constants and row constants) so the baseline
oracle never trusts the script's own output:

1. seed produces the exact quiesced volume-root file set (`cortex-chat.db`,
   `avatars/`, `branding/`, sentinel — no WAL/SHM remnants) and verify passes
   on the source.
2. independent baseline oracle: asset SHA-256s, user/group/key rows,
   independent envelope decrypt of the read key, argon2id digest prefix,
   opaque memory blob verbatim, message authorship, session token,
   `app_settings` values, no absolute-path leak in any cell, 11-entry journal.
3. remap: a plain copied target verifies; sentinel contains no absolute
   paths; verify leaves the artifact byte-identical with an unchanged file
   set (read-only proof, no transient sidecars left behind).
4. negative control: deleted avatar asset → verify fails naming the asset.
5. negative control: corrupted avatar bytes (file present, size unchanged) →
   verify fails on the fixed-constant SHA-256.
6. negative control: forged sentinel digest that "blesses" corrupted bytes →
   sentinel rejected AND the fixed-constant asset oracle still fails.
7. negative control: sentinel asset entry stripped (file present) → rejected;
   entry stripped AND file deleted → still fails from the fixed expectation.
8. negative control: key re-encrypted under a different key → verify fails
   naming the undecryptable key row.
9. negative control: deleted chat message → verify fails naming it.
10. mutate → source verify fails naming all four canaries; frozen
    pre-mutation copy still verifies; independent DB/filesystem checks prove
    canaries absent from the frozen target and present in the mutated source.
11. gate refusals: bad usage exits 2 with usage text; seed refuses a non-empty
    target; verify/mutate refuse without the sentinel.

## Verification evidence (exact commands and results)

| # | Command (cwd `/home/clippy/coding/cortex-chat`) | Result |
|---|---|---|
| 1 | `node --import tsx --conditions=react-server --test tests/restore-fixture.test.ts` | **11/11 pass, 0 fail, ~8.5s** (final tree, after the lead-review round) |
| 2 | `npm run typecheck` | **exit 0, 0 errors** (final tree) |
| 3 | `npm test` (runs `node scripts/run-tests.mjs`; auto-includes the new file) | **71/71 pass, 0 fail, ~12.0s** (60 pre-existing + 11 new) |
| 4 | `git diff --stat 40fe797 -- src/` | **empty** — no runtime source edits |
| 5 | `git status --short` | only this slice's new files on top of the preserved pre-existing uncommitted adoption work (`M .github/workflows/ci.yml`, `M CLAUDE.md`, `M package.json`, `?? .claude/guides/`, `?? AGENTS.md`, `?? docs/regeneration/`, `?? scripts/run-tests.mjs`, `?? tests/`, plus `?? scripts/restore-fixture.mjs`) |
| 6 | Manual smoke (lead-review round): `seed` → `verify` (exit 0) → re-`verify` → DB bytes SHA-256 identical before/after, file set unchanged → `mutate` → `verify` source (exit 1, failures naming canaries) | as stated |
| 7 | Manual probes: forged sentinel digest (matched to corrupted bytes) → exit 1 with sentinel + asset failures; stripped sentinel entry → exit 1; stripped entry + deleted file → exit 1 naming the missing asset | as stated |

Gate corrections during authoring (no assertion relaxed; each fixed by correcting the candidate to match verified actual behavior):

1. Column-order expectations were wrong for four tables — the migrator's
   ALTER-added columns are appended last (`oidc_*`, `login_events.method`,
   `chat_sessions.memory/pinned/assistant_id/project_id`,
   `chat_messages.user_id`). The verify schema contract now records that
   actual order; this is itself compatibility knowledge (an order-insensitive
   comparison would have hidden migration-history drift).
2. The first verify run crashed on a scoping bug (`rowCount` declared inside
   the `try`), then — once visible — the row-count diagnostic exposed a real
   gap: `users` was missing from the verify expectations, so user rows and
   argon2 digest verification were silently skipped (diagnostic said 17 rows,
   direct count was 19). Fixed by adding the `users` expectation block;
   `verify` now compares 19 rows across 11 tables plus 3 required-empty
   tables. The catch: the diagnostic count alone caught it only because the
   smoke run surfaced the crash — exactly why verify prints counts.
3. The test's refusal-case directory was created without `mkdirSync`
   (test-authoring error, ENOENT) — fixed in the test.
4. An edit accidentally duplicated the `seed()` declaration (non-async shadow)
   — caught immediately by the smoke run's SyntaxError; fixed.

Lead-review round (2026-10-01, both review findings applied):

1. **Layout corrected to the actual mounted volume root** — `<dir>/cortex-chat.db`,
   `<dir>/avatars/`, `<dir>/branding/`, sentinel at the root (was a nested
   `data/` layer that no deployed stack mounts). Script constants, sentinel,
   tests and this record all updated; the main harness now captures the exact
   `cortex-chat.db` source/target files, not a `.sqlite` glob.
2. **Asset oracle made target-independent** — verify now judges assets from
   the hardcoded `AVATAR_PNG`/`BRANDING_PNG` constants and validates the
   sentinel structurally against the fixed expectation instead of trusting
   target-supplied digests/paths; new negative controls cover corrupted
   bytes, a forged sentinel digest matched to corrupted bytes, and a
   stripped sentinel entry (with and without the file deleted).
3. **Comment accuracy** — "no runtime source imported" was false; replaced
   with "no app boot / DB singleton / route code; retained dependencies are
   explicit (real migrator + real crypto/password modules)".
4. **verify made read-only** — `readonly` + `fileMustExist` open, no
   pragmas/checkpoint; quiesce gate (WAL/SHM before open ⇒ failure, left for
   forensics); transient read-only sidecars removed after close (documented
   SQLite behavior for WAL-mode DBs); self-test asserts the artifact's DB
   bytes and file set are unchanged by verification.

## Honest limits (do not over-claim)

- **State-level only.** No login flow, browser, route handler, server boot or
  backend integration is exercised. "Fixture verifies" ≠ "chat works after
  restore". The route/persistence journey remains the top gap in
  `docs/regeneration/index.md`; whole-stack restore (Neo4j, files, compose
  wiring) remains the lead/main-agent slice — this fixture supplies the chat
  oracle for it.
- The seed runs the migrator against a fresh empty DB; it does not rehearse a
  mid-journal upgrade replay of old rows (recorded gap in the index).
- The fixture's own `verify` is the chat-side oracle; the lead still needs to
  independently freeze/compare the app-side (graph/files) halves and to prove
  an incomplete-but-checksum-valid copy fails end to end (protocol step 6).
- Keys/passwords are synthetic and hardcoded on purpose; they must never be
  replaced with real credentials, and the sentinel must never carry real
  secrets.

## Interface to the lead / main restore agent

Invocation model: **the main qa/restore harness owns when and where this runs**
(never against a live deployment's data volume, no competing runtime — seed
additionally refuses non-empty targets, but discipline is the rule).

1. **Seed & freeze:** run `node scripts/restore-fixture.mjs seed <dir>` inside
   the quiesced fixture stack; archive the whole `<dir>` with the real backup
   command. `<dir>` is the data volume root, so the capture must take the
   exact `cortex-chat.db` file plus `avatars/` and `branding/` — **not a
   `.sqlite` glob**. Keep the sentinel with the archive.
2. **Post-snapshot writes:** run `mutate` on the source only after the
   snapshot; retain the canary IDs (`fx-msg-canary-0005`,
   `fx-usage-canary-0001`, mutated `chat_sessions.memory` of `fx-chat-0001`,
   `avatars/fx-canary-0001.png`) as exclusion assertions.
3. **Restore & compare:** after restoring the chat volume, run `verify` on the
   restored directory (exit 0 = chat state complete at the frozen baseline)
   and additionally assert the canary IDs/files are **absent** (the self-test
   shows the exact independent checks). `verify` is read-only — it will not
   write the restored artifact, and it refuses a non-quiesced set (WAL/SHM
   present at open).
4. **Challenge the oracle:** drop or corrupt an avatar/branding file, or drop
   a chat row, from the restored copy and confirm `verify` exits 1 naming it
   (self-test equivalents: tests 4–7). Editing the sentinel cannot hide the
   damage — the sentinel is validated against the fixed expectation and the
   asset oracle comes from the script constants.
5. **Claim discipline:** report chat evidence as *state-level fidelity*; any
   login/browser claim needs the separate route/browser gate.

Next actionable step (lead): wire this fixture into the whole-stack rehearsal
(recipe above), then re-run `verify` against the actually restored volume and
record the outcome in the campaign receipt.

## Addendum (2026-10-01, fixture pack v2 — corrected to the accepted producer)

`FIXTURE_VERSION` is now **2**: the restored citation in `fx-msg-0002` carries
the full public-Source shape (`document_id`/`chunk_id`/`content`/numeric
`score`/`metadata.filename`). After a superseded first proposal (two-chunk
`.txt` constants — retracted), the pack aligns to the **accepted MAIN
producer** (source oracle ~1565-71): ONE markdown chunk, filename
`fixture-source.md`, fixed verbatim text (see
`2026-10-01-citation-content-correction.md`). Verify gained the explicit
`citation(fx-msg-0002)` check; the v1 pack and its evidence remain recorded as
history.
