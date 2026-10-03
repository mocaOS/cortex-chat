# Record: regenerative-software adoption slice — 2026-10-01

Work package: adopt the regenerative-software operating model for cortex-chat,
compacting the oversized root agent instructions into a scoped hierarchy,
adding meaningful deterministic compatibility evaluations at existing
boundaries, and leaving a durable local maintenance packet — **preserving all
production behavior** (no runtime source, migration, default, or
dependency-version changes).

- Repository: cortex-chat @ `40fe79799c4729c4b695890566ef3a51746b3b5e` (clean `main`, no local modifications at start).
- Playbook: `../cortex-app/REGENERATIVE-SOFTWARE.md` v2.3.0, sections 3.2, 9, 10, 13, 18.1, 22.
- Ownership: writes confined to cortex-chat; cortex-app / cortex-skills untouched (read-only).
- Constraints honored: no git commit/reset/stash, no deployment or production access, no paid calls, no runtime changes, apply-patch-style edits only.

## What changed

### 1. Instruction hierarchy (7 primitives, root ≤80 lines)

- `CLAUDE.md` rewritten: **40 lines** (was 398). Carries the seven-primitive session contract (Start / Intent / Compilation / Evaluations / Provenance / Pace / Deletion / Compaction / Finish), hard constraints, area map, and commands. Canonical owner of all rules.
- `AGENTS.md` added: minimal explicit **read fallback** for non-Claude harnesses; points to `CLAUDE.md` + scoped guides; states its own autoload status is unverified (no copy of the rules — a pointer, not a duplicate).
- `.claude/guides/` (5 scoped guides, content moved from the old root verbatim except noted corrections):
  - `auth-and-identity.md` — superadmin/default-group bootstrap, sessions, password reset/email, OIDC SSO, self-registration, demo mode.
  - `cortex-backend-integration.md` — key tiers/encryption, proxies & allowlist, upload, web import, analytics injection, backend resilience behaviors, collection scoping.
  - `chat-streaming-memory.md` — SSE/memory contract + incident constraints, chat UX pack, souls, projects, voice; records the UI-journey evaluation gap.
  - `design-system.md` — tech stack, MOCA design system non-negotiables, copy/locale conventions.
  - `operations-and-state.md` — state ownership (SQLite/WAL/avatars/branding/encryption), migrator semantics, env conventions incl. anonymization rule, GlitchTip.
- Expanded per-session context cost went **down** (root 398 → 40 lines); deep detail is loaded only when the touched area requires it.

### 2. Corrections harvested into the owning guides (documentation changes only)

Found by the state-investigation subagent against source, fixed in guides, runtime untouched:

1. Sessions were documented as "30-day **sliding** TTL" — code sets a **fixed** `expires_at` at creation; `getAuth()` never extends it (`src/lib/auth/session.ts`). Corrected in `auth-and-identity.md`.
2. Storage was documented as "bind-mounted in Docker" — compose mounts the **named volume** `cortex-chat-data` (`docker-compose.yml`). Corrected in `operations-and-state.md`.
3. Avatars were described as WebP-converted — uploads keep their format (`.png/.jpg/.webp/.gif`, `src/lib/avatars.ts`). Corrected in `operations-and-state.md`.
4. Message authorship was described as unconditionally "preserved by id" — preservation applies to existing **non-null** authors; stored-null authors are attributed to the caller on replacement, and ordering timestamps are regenerated (`src/app/api/me/chats/[id]/route.ts`). Corrected in `chat-streaming-memory.md`.

### 3. Deterministic compatibility evaluations (new; no runtime changes)

Runner: `node --import tsx --conditions=react-server --test tests/*.test.ts` via new `npm test` script (no new dependencies; tsx/better-sqlite3 already present). CI: `contract-tests` job added to `.github/workflows/ci.yml` (typecheck job unchanged). Each test file runs in its own node:test process. All SQLite work happens in throwaway temp DBs; `./data/` is never touched.

Files: `tests/streaming-contract.test.ts` (12), `tests/negative-control-return-at-done.test.ts` (3), `tests/api-fetch-retry.test.ts` (6), `tests/upstream-retry.test.ts` (8), `tests/rate-limit-message.test.ts` (4), `tests/cortex-analytics.test.ts` (6), `tests/crypto-password.test.ts` (9), `tests/sqlite-contracts.test.ts` (10), `tests/proxy-strip-parity.test.ts` (3) = **60 tests** (as of the review round; originally 59 — see below). Boundary→gate mapping with incident constraints lives in `docs/regeneration/index.md`.

### 3b. Review round (same day, independent review findings — all addressed)

1. **Shared oracle instead of asserting the broken shape directly.** The negative control originally asserted the mutant's broken event order itself. It now runs a tiny shared observable oracle (`tests/helpers/late-memory-contract.ts`: late memory retained after `done`, verbatim, transport fully consumed) against BOTH implementations unchanged; the mutant is imported *outside* the rejection check and the test asserts the oracle's own `AssertionError` (message names `memory_update`) — a module/import error can never masquerade as a rejection. A third test is a structural drift guard proving the retained fixture is `src/lib/api.ts` with exactly one behavioral mutation (comment-stripped, `return;`-normalized byte-equality). **Fixture maintenance scope (stated):** `tests/fixtures/api-return-at-done.ts` is a full copy of the real parser kept intentionally in sync behind the same `askQuestionStream` entry boundary; it is imported only by tests, exists solely to prove the gate rejects the stop-at-`done` failure mode, and is NOT a replacement candidate — no replacement or reconstruction claim is made for it.
2. **Shell-independent runner.** `npm test` now runs `node scripts/run-tests.mjs`, which builds the explicit test-file list with `fs.readdirSync` and spawns `process.execPath` with the loader flags — no dependence on shell glob expansion (Windows `cmd` / PowerShell would not expand `tests/*.test.ts`), no new dependency.
3. **Typecheck description corrected.** `npm run typecheck` is a type gate (`tsc --noEmit`), not a linter; wording fixed in `CLAUDE.md` and `docs/regeneration/index.md`.
4. **Fresh-session claim narrowed and strengthened.** The first probe named the guide/method, so it only proved *navigation*. A second ordinary-task probe — no instruction or guide names — asked how to approach a real change ("chat titles currently come from the first user message; what constraints apply, which files first, what would you run?"). The fresh session followed the hierarchy unprompted: read `CLAUDE.md` first, then the scoped guides (`chat-streaming-memory`, `operations-and-state`, `design-system`, `auth-and-identity`, `cortex-backend-integration`) and `docs/regeneration/index.md`, applied the constraints (200-char title cap discrepancy, author-only title mutation, stream-past-`done`, demo lockdown, anonymization, no-commit rule), named both gate commands, and correctly flagged that the gates provide no browser-journey evidence. **Loaded-vs-requested reads:** in this ordinary-task transcript the agent issued no explicit `Read` of `AGENTS.md` yet went straight to `CLAUDE.md` — consistent with the harness delivering `AGENTS.md` into context automatically, but the transcript cannot prove injection, so the recorded claim is "read rules were followed", not "autoload observed". (In the first probe the agent additionally issued an explicit `Read AGENTS.md`.) Transcript: `/tmp/opencode/chat-adoption/fresh-session-ordinary-task.log`.
5. **Crypto/SQLite gates audited for meaning:** the crypto/password tests exercise the real `encryptSecret`/`decryptSecret`/`hashPassword`/`verifyPassword` with only the environment controlled (no mock of the code under test); the SQLite tests run the repository's real migration journal through the real Drizzle migrator against throwaway temp databases. `git diff --stat 40fe797 -- src/` remains empty — no runtime edits in the review round either.

### 4. Freeze gate before runtime candidate / negative controls

- Gate order respected: **baseline recorded first** (typecheck on clean `main`, below), then the gate was installed and frozen; no runtime candidate exists in this slice, so stage 5 (candidate evaluation) is intentionally empty — the gate guards future changes.
- Negative control 1 (behavioral, isolated fixture): `tests/fixtures/api-return-at-done.ts` is an isolated copy of the SSE parser with the pre-incident "return at `done`" mutation; the contract test proves the gate **rejects** it for the intended obligation (late `memory_update` silently dropped → cross-turn recall lost on reload/device-switch) and that the real implementation passes the identical scenario as a healthy control. The fixture is imported only by tests, never by runtime code.
- Negative control 2 (historic state, isolated temp fixture): a reconstructed **legacy schema** (0007 ALTER without `ON DELETE SET NULL`, applied through the real migrator) proves a bare project DELETE violates the FK (`FOREIGN KEY constraint failed`) while the explicit-detach pattern the delete handlers use succeeds — the documented reason handlers never rely on FK actions.

## Verification evidence (exact commands and results)

| # | Command (cwd `/home/clippy/coding/cortex-chat`) | Revision | Result |
|---|---|---|---|
| 1 | `npm ci` | 40fe797 (baseline) | installed 441 packages, no errors |
| 2 | `npm run typecheck` | 40fe797 (baseline) | **exit 0, 0 errors** (after an initial run failed only because `node_modules` was absent; deps installed before judging) |
| 3 | `npm run typecheck` | final tree | **exit 0, 0 errors** (tests are included in the typecheck gate; re-run after the review round, still 0 errors) |
| 4 | `npm test` | final tree (post review round) | **60/60 pass, 0 fail, 0 skipped, ~11.9s** (`# tests 60 / # pass 60 / # fail 0 / # skipped 0`). Pre-review final was 59/59 (~12s); the +1 is the new fixture drift-guard test, the oracle refactor replaced 1 direct-shape assertion with 2 oracle runs (healthy + mutant). |
| 4b | `node scripts/run-tests.mjs` (what `npm test` invokes) | final tree | same runner — spawn of `process.execPath` with explicit file list; no shell glob |
| 5 | `npm test` (during authoring) | intermediate | 8 fails traced to **test-authoring errors only** (wrong expectations about `dflt_value` string form, missing explicit ids in raw SQL fixtures, wrong shutdown-event ordering, legacy fixture accidentally migrating with the real SQL folder). Each was fixed by correcting the test/fixture to match verified actual behavior — no assertion was relaxed to fit a passing candidate, no runtime change was involved. A wrong-expectation fix is a gate correction, recorded here per the playbook. |
| 6 | `git status --short` | final tree | only intended files: `M .github/workflows/ci.yml`, `M CLAUDE.md`, `M package.json`, `?? .claude/guides/`, `?? AGENTS.md`, `?? docs/regeneration/`, `?? tests/` |
| 7 | Fresh-session check #1 (navigation; names instructions): `opencode run "Fresh-session check. Follow this repository's agent instructions…"` | final tree | Harness session read `AGENTS.md` (explicit `Read` in transcript) → `CLAUDE.md` → `.claude/guides/auth-and-identity.md` → `docs/regeneration/index.md` and correctly answered (Finish rule; OIDC owner + pre-hijack mitigations; `npm run typecheck` + `npm test`), editing nothing. Because the prompt named the guide/method, this probe's claim is limited to **navigation**; the ordinary-task probe (row 7a) covers instruction-following. |

| 7a | Fresh-session check #2 (ordinary task, no instruction names): `opencode run "I need to change how chat titles are generated in this app…"` | final tree | Read rules applied unprompted (`CLAUDE.md` first, then scoped guides + index), constraints and both gate commands named, honest gap flagged (no browser-journey evidence). Claim scope: **read rules followed**; no explicit `AGENTS.md` read in this transcript (consistent with, not proof of, automatic delivery). Transcript: `/tmp/opencode/chat-adoption/fresh-session-ordinary-task.log` |

Selection counts honesty: baseline had **zero tests** (no test files existed; CI was typecheck-only) — there is no inflated "replacement" or "reconstruction" claim to make: nothing was replaced or reconstructed; the claims are *instruction-adoption (read rules fresh-session-observed on the AGENTS.md entry path; automatic injection unproven)* and *evaluation-improvement (60 tests; 2 behavioral negative controls — return-at-done mutant and legacy-schema FK fixture — plus 1 structural drift guard)*.

## Actual completion and claims

- Knowledge readiness: instruction hierarchy `evaluable` and **fresh-session-observed** (navigation on the instruction-naming probe; read-rule application on the ordinary-task probe; automatic injection of `AGENTS.md` remains unproven from transcripts) on the AGENTS.md entry path; capability inventory in `docs/regeneration/index.md` with per-area dispositions.
- Verified change types: **documentation/instruction improvement** + **evaluation improvement**. Not claimed: replacement, reconstruction, operational observation, retirement (none attempted; no live environment).
- Runtime behavior: byte-identical production code (`src/` untouched — verify with `git diff --stat 40fe797 -- src/`).

## Remaining uncertainty, gaps, and observed weaknesses preserved

- **Live gaps (honest):** no browser journey evidence, no backup/restore rehearsal, no provider/backend/IdP integration evidence, no deployed-runtime observation. Autoload of `CLAUDE.md` by Claude Code is documented expectation, **not observed** in this engagement.
- **Behavioral route-handler gate is structural only today** (`proxy-strip-parity`): route handlers need a Next request context; behavioral coverage is the next slice (see index checkpoint).
- **Observed implementation weaknesses recorded, deliberately not changed** (runtime frozen by the work package; each is a candidate slice, and none invalidates the installed gates):
  1. Late-memory persistence is best-effort/unawaited with three independent write paths — durable last-write ordering for the memory blob is not guaranteed (the *parser-side* contract is gated).
  2. `fetchUpstreamWithRetry` passes `signal` only as the separate abort argument; an abort during the retry sleep can still be followed by another fetch.
  3. Clean EOF without `done` settles neither completion nor error (characterized by a test, treated as accepted behavior).
  4. Admin user deletion leaves the deleted user's avatar file behind; file↔DB pointer updates are not transactional.
  5. Mid-journal historical upgrade replay (rows inserted between migrations 0000→0010) is not yet covered by a fixture.

## Next slice

Behavioral proxy gate: drive the real `/api/ask/stream` and generic `/api/proxy` through a Next runtime (or request-context harness): 401/403 gating, demo throttle, allowlist, `X-API-Key` injection, identity encoding, identifier stripping, relay. Prerequisite: Next server harness in tests. Success criterion: strip parity and auth gates judged behaviorally. After that: browser journey harness (send → done → late memory → reload recall) and WAL backup/restore rehearsal.
