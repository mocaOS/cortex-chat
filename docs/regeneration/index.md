# Cortex Chat — regeneration index

Local map for the regenerative-software campaign in this repo. Keep it small:
commands, capability→path map, gates, and the current checkpoint. Detailed
history lives in `records/`. Cross-repo campaign context (cortex-app backend,
skills): `../cortex-app/.claude/regeneration.md` — read if present; **this
repo must stand alone without it.** Portable playbook:
`../cortex-app/REGENERATIVE-SOFTWARE.md` (v2.14.0; adoption baseline v2.3.0).

## Session instruction hierarchy (load map)

| Entry | Delivers | Canonical owner | Evidence / uncertainty |
|---|---|---|---|
| Claude Code, root start | `CLAUDE.md` (autoload expected) | `CLAUDE.md` (7-primitive contract + map, ≤80 lines) | **Unobserved** — no fresh Claude Code session has been recorded; treated as documented expectation, not observed delivery |
| opencode & other harnesses, root start | `AGENTS.md` (autoload expected for OpenCode) | pointer file — requires reading `CLAUDE.md` + scoped guide | **Sampled 2026-10-01**: (a) instruction-naming navigation probe; (b) ordinary-task probe with explicit `CLAUDE.md`/guide/index reads, no explicit `AGENTS.md` read in that transcript. See the adoption record. Read rules were followed; transcripts do not establish automatic delivery across harnesses. |
| Scoped guides | Read on demand (explicit read rule in root; no harness import expansion) | `.claude/guides/*.md` | Verified by the same fresh-session check |

Rule: one canonical owner per fact. Root stays ≤80 lines; details live in the
scoped guide that owns them; never duplicate.

## Gates (deterministic, local)

| Gate | Command | Scope |
|---|---|---|
| Typecheck | `npm run typecheck` (`tsc --noEmit`) | whole repo, structural — a typecheck is not a linter |
| Contract suite | `npm test` | behavioral contracts at existing boundaries (below) |

Runner: `node scripts/run-tests.mjs` — builds the explicit test-file list with
`fs.readdirSync` and invokes `process.execPath` (no shell-glob dependence;
dependency-free). Runs on Node 20/22. No new dependencies — tsx and
better-sqlite3 were already dev/runtime deps.
CI: `.github/workflows/ci.yml` runs typecheck + contract suite on PRs/main.

What the suite gates (boundary → file):

- **SSE client contract** (`src/lib/api.ts` `askQuestionStream`) — `tests/streaming-contract.test.ts` (12): backend v2 done-before-memory ordering (keep reading past `done`), legacy ordering, combined frame, empty-`sources` guard, framing/heartbeat rules, flag accumulation, 429 → `onRateLimited`, terminal non-OK statuses, `event: shutdown` resubmit (budget, request-id stability, restart error).
- **Late-memory oracle + negative control** — `tests/negative-control-return-at-done.test.ts` (3) + `tests/helpers/late-memory-contract.ts` + `tests/fixtures/api-return-at-done.ts`: one shared observable oracle (late memory retained after `done`, verbatim, transport fully consumed) runs against the real implementation (healthy control) and against an isolated mutant that "returns at done" (the pre-incident behavior), which the oracle's own assertion must reject — the import happens outside the rejection check so a module error can never masquerade as a rejection. A structural drift guard proves the fixture is the real parser with exactly that one behavioral mutation; if `src/lib/api.ts` evolves, the guard fails and the fixture must be re-synced. Maintenance scope: the fixture is test-only, exists solely to prove the gate rejects this failure mode, and is NOT a replacement candidate.
- **Browser retry wrapper** (`apiFetch` via public consumers) — `tests/api-fetch-retry.test.ts`: 429 → `RateLimitError` (never retried), GET-only 5xx retry, POST connect-failure-only retry, `X-Request-ID` header.
- **Server-side upstream retry** (`src/lib/upstream-sse.ts`) — `tests/upstream-retry.test.ts`: 502/503/504 + connect-failure matrix, auth verdicts (401/403)/429/500 never retried, `Retry-After` floor/cap (750ms fallback, 3000ms cap), exhaustion returns last response, abort stops retries.
- **Rate-limit messaging** — `tests/rate-limit-message.test.ts`: 6h horizon boundary (21600 burst vs 21601 quota).
- **Analytics injection** — `tests/cortex-analytics.test.ts`: substitution/fallback, prepended `conversation_history` entry, fail-open on malformed JSON.
- **Crypto & password** — `tests/crypto-password.test.ts`: AES-256-GCM envelope layout (12|ct|16), random IV, tamper/wrong-key rejection, key validation (missing / non-32-byte), argon2id verify + fail-closed on empty/malformed digests.
- **SQLite state contracts** — `tests/sqlite-contracts.test.ts` (throwaway temp DBs, real Drizzle migrator + repo journal): WAL + foreign_keys pragma contract, full 0000–0010 journal applies and is idempotent, historical column contracts (`memory` nullable TEXT, `pinned` default 0, `login_events.method` default `password`), 19-FK inventory with actions, cascade/SET NULL deletion behavior, and a **legacy-schema negative control** (ALTER without `ON DELETE SET NULL` ⇒ bare project delete violates FK; explicit detach succeeds).
- **Recovery fixture** — `scripts/restore-fixture.mjs` + `tests/restore-fixture.test.ts`:
  real migrated SQLite, passwords/encrypted keys, opaque memory/messages and fixed
  asset bytes at the actual volume root. Seed refuses existing state; verify uses
  fixed expectations, not target-sentinel hashes. 11 controls; state-level only.
  Actual container backup/restore result is in the companion app's
  `qa/restore/RESULTS.md`; fixture record in `records/2026-10-01-restore-fixture.md`.
- **Proxy strip parity** — `tests/proxy-strip-parity.test.ts`: STRUCTURAL (source-level) — both ask proxies strip `session_id`/`assistant_id`/`project_id`. The behavioral journey below now checks this in real Next context.
- **Behavioral ask + persistence journey** — `scripts/chat-journey-checks.ts`:
  real Next dev HTTP context, synthetic users/isolated SQLite, controlled loopback
  upstream; auth/scope/headers/allowlist/ID stripping, held late memory, reload/
  replay, isolation/concurrency and rollback. Exact replay/results:
  [`records/2026-10-02-ask-memory-journey.md`](records/2026-10-02-ask-memory-journey.md).
  Forwarding and late-memory negative controls: `tests/chat-ask-oracle.test.ts`,
  `tests/chat-memory-oracle.test.ts`; harness isolation/receipt controls:
  `tests/chat-journey-runtime.test.ts`. Source-extracted actual callback probes
   historically confirm two **failed page obligations** in D. Positive candidate
   gates retain that baseline; actual UI follow-up is below.
- **Restored-state HTTP consumer** — `scripts/restore-consumer.mjs` and
  `tests/restore-consumer.test.ts`: isolated locked install/build/server on copied
  state; app orchestration joins a real restored backend. Gate v2 judges scoped
  collections and citation `/content` exactly; `/file` 404 is the proxy boundary,
  never a route to add for the fixture. Results and replay: companion app
  `qa/restore/RESULTS.md`; local records include `2026-10-01-restore-consumer.md`
  and `2026-10-01-citation-content-correction.md`.
- **Actual shutdown UI + HTTP** — `scripts/chat-shutdown-journey.ts <fresh-output>
  <fresh-id> http|browser`, `scripts/tsconfig.chat-shutdown.json`; raw shutdown after
  partial content, content-free held retries, exact durable history/opaque memory,
  two-resubmit exhaustion, direct feedback/regenerate and settled/legacy controls.
  `tests/chat-shutdown-oracle.test.ts` challenges the comparators. Receipt:
  [`records/2026-10-02-ask-shutdown.md`](records/2026-10-02-ask-shutdown.md).

## Capability inventory (campaign view)

| Capability | Disposition | Evidence / notes |
|---|---|---|
| SSE streaming + conversation memory | improved | behavioral gate + negative control (`streaming-contract`, `negative-control-return-at-done`) |
| Retry / resilience (browser + proxy) | improved | behavioral gates (`api-fetch-retry`, `upstream-retry`); upstream-fetch abort-during-sleep characterized, not gated |
| Rate-limit messaging | improved | boundary gate (`rate-limit-message`) |
| Analytics injection | improved | gate (`cortex-analytics`) |
| Keys, encryption, password hashing | improved | gate (`crypto-password`); key-rotation mechanism does not exist (by design, recorded) |
| SQLite state & migrations | improved | `sqlite-contracts` + real migrated/encrypted recovery fixture and quiesced sidecar restore; mid-journal upgrade replay and online/WAL-inflight consistency not covered |
| Proxy route handlers (auth gating, header wiring, allowlist) | improved (ask + selected reads) | real Next HTTP ask checks now behavioral; synthetic backend scope, not live backend proof; demo/relay-event-feed open |
| Auth/identity flows (OIDC, reset, registration, demo) | deferred-with-reason | route-level behavior needs Next request-context harness; OIDC needs a live IdP (see `docs/dev/keycloak/`); strongest next slice |
| Chat UX journeys | improved (selected actual UI) | held SSE races, settled/legacy controls, reload/replay and dark EN/DE; browser fixture reuses the real HTTP runtime |
| Souls UI, broader projects, voice | deferred-with-reason | broader provider/browser lifecycle remains; selected project share/move/delete gates are listed separately below |
| Selected project-chat lifecycle | improved | Overlap/reverse Chromium21 each +25 established stages, explicitly inherited when inputs match; delayed positive project-list ordering, other uncertain outcomes/unavailable reconciliation and multi-replica remain open |
| Upload / web import / documents UI | deferred-with-reason | same browser-harness gap; backend contract assumptions documented in `cortex-backend-integration.md` |

## Historical checkpoint (2026-10-01)

- Adoption slice complete: root contract + AGENTS.md fallback + 5 scoped guides installed; contract suite (60 tests incl. the shared late-memory oracle with healthy + mutant controls and a fixture drift guard, plus the legacy-schema SQLite negative control) green; shell-independent runner; CI wired. See `records/2026-10-01-adoption-slice.md` for exact commands/results.
- No runtime source, migration, default, or dependency-version changes were made.
- Follow-up restore slice: full contract suite **71/71**, typecheck passed;
  actual quiesced storage restore through app's sidecar accepted frozen Chat rows,
  key decryptability and bytes, rejected a checksum-valid missing-avatar copy.
  No login/browser or active-WAL claim follows from that storage check.
- Historical next action was the behavioral route gate; the current checkpoint
  below closes ask/persistence HTTP coverage. Demo throttle and relay event-feed
  integration remain separate gaps.
- Consumer follow-up completed: app run `restored-consumers-20261001-k`, **20/20
  stages**, **27/27 Chat HTTP checks**, 15 backend probes, original restored state
  unchanged, zero provider hits/egress attempts and cleanup passed. Contract suite
  reached **90/90** with typecheck clean. Node 22.22.3 locked install is not the
  CI Node 20 or production Alpine runtime; no browser/model claim. This adds
  password-login/history/content evidence. Ask/persistence follow-up is below;
  SSO/reset/demo and browser coverage remain open.

## Historical checkpoint D — 2026-10-02

`chat-ask-memory-20261002-d`: evaluation execution exit 0, **59 HTTP checks + one
healthy callback control + two defect confirmations**; cleanup/input-drift checks
passed. Contract suite **122/122**, repo and evaluation-script typechecks passed.
Real `next dev` with private copies of existing dependencies; production
source/schema/migrations/locks unchanged. Restore K not rerun.

**Page late-callback isolation and regenerate-snapshot obligations FAIL** in
source-extracted callback + HTTP reproductions. Browser remains not-run; passing
test-driver persistence does not accept page wiring. Owning receipt/follow-up:
[`records/2026-10-02-ask-memory-journey.md`](records/2026-10-02-ask-memory-journey.md).
Completed follow-up is the current checkpoint below; D's baseline is retained.

## Historical checkpoint b — `chat-ui-turn-bound-20261002-b`

Authorized `page.tsx` turn/session-bound callback + persistence fix. **Browser
33/33; HTTP 59 checks + six positive extracted-callback gates; suite 129/129;
repo + both script typechecks PASS**. Healthy settled/legacy and dark EN/DE controls
passed; actual UI rapid next-send, regenerate, edit-last and chat-switch isolation
passed. Schemas/migrations/dependency resolution unchanged; server LWW retained.
Both final runs retained receipts and removed owned scratch. D/K not replayed.
Broken browser baseline i and deterministic negative controls retained.

Replay/tooling/identities/resources:
[`records/2026-10-02-turn-bound-ui.md`](records/2026-10-02-turn-bound-ui.md).
Next at b: shared project rebase/adoption with overlapping streams and switch-away/back,
using this fixture and frozen LWW expectations. Production runtime parity remains
a separately identified environment prerequisite.

## Historical checkpoint — `chat-project-lifecycle-20261002-c`

Project gate v1.1: **HTTP8/8; browser23/23**. Repaired evidenced same-ID adoption,
delayed-read navigation/recall, returning own live-turn view/loading and overlapping
relay ownership. Healthy controls/positive gates frozen before fixes; full broken
b-page baseline and unsuccessful evaluator attempts retained. Runtime changes only
`page.tsx`, `chat-events.ts`, ask relay; server atomic full-snapshot LWW, opaque
memory, done-visible completion and regenerate/edit semantics retained. No schema,
migration, dependencies, commit/deploy/publication or live/paid-provider calls.

Combined candidate: established HTTP59 + six positive callbacks and Chromium33/33
passed under **fresh integrated IDs after changed inputs**; suite132/132; repo and
three evaluation typechecks pass. K/D/b historical receipts remain unchanged.
Read-only closeout checks retrievable receipts, required selections, current
consumed-input hashes, four matching runtime manifests and successful cleanup.
Exact evidence, attempts/resources, identities and replay:
[`records/2026-10-02-project-lifecycle.md`](records/2026-10-02-project-lifecycle.md).

Next local slice: shared-project edit/regenerate after remote adoption, overlapping
refresh ordering and disconnect/reconnect with independent controls. Production
Node20/Alpine remains a separate owned-environment prerequisite. Do not replay
completed gates without changed relevant inputs or a new evidence claim.

## Historical checkpoint — `chat-project-followup-20261002-b`

**Follow-up HTTP6/6; Chromium29/29 v1.2.** Remote-adopted regenerate/edit preserve
immutable local at-send snapshots, local forks and loaded fallback; real overlapping
GETs retain latest-request state through feedback. Positive baseline e reproduced
missed idle settled state and ghost-streaming after missed remote completion.
Page-only adopt-on-open / ephemeral-pair cleanup-on-error fixes pass native
disconnect/reopen, exact feedback recall and read-only adoption. Server full-snapshot
LWW, opaque memory, done-visible completion, schemas/migrations/dependencies intact.

Changed page justified fresh integrated IDs: project HTTP8/8, Chromium23/23;
ask HTTP59 + six callbacks and Chromium33/33 PASS. Suite132/132, repo + four
evaluation typechecks and app docs validator/10 controls PASS. Baselines, evaluator
corrections, browser resource launcher, final hashes and retrievable
read-only closeout: [`records/2026-10-02-project-followup.md`](records/2026-10-02-project-followup.md).
c/b/D/K receipts preserved; no historical replay IDs used.

Next: reconnect while a teammate is still streaming (including repeated drops and
late-join replay without duplicate pairs), then remote writes during own done-visible
late-memory window. Freeze controls/ownership before changes, use owned root-backed
scratch and actual consumer probes. Production Node20/Alpine remains a separate
owned-environment prerequisite. Do not replay completed gates without changed
relevant inputs or a new claim.

## Historical checkpoint — `chat-project-continuity-20261002-a`

Still-live native reconnect twice, fresh missed settled-prefix adoption alongside
relay replay, and remote append/same-exchange adoption during own held late-memory:
**HTTP7/7, Chromium25/25 v1 PASS**. Frozen unchanged-page baseline rejected three
positive value gates with healthy controls/selection/errors passing. Repair is
page-only: remote live snapshot overlays fresh settled state; selecting late local
recall selects matching history and immutable at-send snapshot together. Valid
origin writes remain eligible under unchanged server full-snapshot LWW. No CAS,
schema/migration/dependency or relay protocol changes.

Fresh combined candidate: follow-up HTTP6/6/browser29/29, project HTTP8/8/browser23/23,
ask HTTP59+six callbacks and Chromium33/33 PASS. Suite132/132, repo + five evaluation
typechecks and app docs validation/10 controls PASS. Final closeout,
before-edit gate/source snapshots, baseline and final identities/resources:
[`records/2026-10-02-project-continuity.md`](records/2026-10-02-project-continuity.md).
All previous receipts retained; no historical behavioral IDs replayed.

Next: hold genuine adoption GETs across relay replacement and arriving tokens;
exercise local terminal navigation away/back while compaction remains held. Verify
selected view, recall and at-send snapshots through non-repairing consumers;
freeze coherent LWW/healthy controls before changes. Production Node20/Alpine
remains a separately identified owned-environment prerequisite.

Portable playbook harvest v2.8.0 generalizes the follow-up/continuity lessons;
historical records keep their executed v2.7.0 basis and all runtime/evaluator
receipts remain unchanged. This documentation update adds no journey execution.

## Historical checkpoint — `chat-project-selection-20261002-a`

Genuine held adoption GET across relay replacement and more tokens, then terminal
sidebar-away/browser-back under held compaction: **HTTP6/6, Chromium29/29 v1 PASS**.
Frozen baseline29/27 rejects exactly two regenerate-at-send gates; healthy controls
pass. Page-only `loadSession` repair retains a valid local immutable snapshot when
the loaded last exchange matches; fresh loaded history/recall and different-exchange
stored fallback remain the owners. No CAS/schema/migration/dependency changes.

Fresh integrated continuity7/25, follow-up6/29, project8/23 and ask HTTP59+six
callbacks/browser33 pass. Suite132/132, repo/six evaluation typechecks, docs
validator/10 controls and three-repo diff checks pass. Target crash and measured
30.8s dev event-route compile/reopen timeout remain failed attempts; final fresh
gates pass without relaxed bounds. All successful scratch removed after receipts;
prior baselines/diagnostics intact. Final10-run/225-file verification, identities,
commands and resource handoff:
[`records/2026-10-02-project-selection.md`](records/2026-10-02-project-selection.md).

Next: terminal edit-last after return plus different adopted last-exchange stored
fallback, contrasted with fresh-page fallback while compaction remains held.
Use direct consumers/read-only adoption/coherent origin-LWW controls before repairs.
Production Node20/Alpine and broader shutdown/share/move/delete remain separate.

Portable harvest v2.9.0 folds in terminal retry-state retention, held-read/latest
progress composition, timed execution diagnosis and selective stage reconciliation.
Owning streaming/storage guides and continuation pointers carry the local rules;
selection's executed v2.8.0 basis and all gate/runtime/receipt bytes stay intact.
This harvest adds no behavioral execution or process-wide isolation claim.

## Historical checkpoint — `chat-project-terminal-20261002-d` (blocked)

Resumed selection; runtime **unchanged**, no product fix justified. Terminal HTTP
a **6/6 PASS**. Chromium a/b/c/d exits1:43/47,20/22 (target crash),45/47,45/47.
Complete c/d runs pass all five direct edit/regenerate memory/prefix, no-repairing-GET,
initial feedback and fork controls; remaining fresh feedback selectors race a genuine
post-completion adoption. Final **v1.3 frozen/typechecked, browser not-run**: hold
the actual read before origin release, then consume its exact coherent selection.
This is partial evaluation/knowledge work, not an accepted browser/product slice.

Suite at d: **122/132,10 failures,0 skip/cancel**, exit1: unchanged2GiB scratch
preflight blocks runtime prepare/failure controls and their dependent checks.
Repo + terminal types, app docs validator/10 controls and whitespace pass. Root~1.9GiB
free; `/tmp`/swap full. New failed source/SQLite/log/profile diagnostics retained;
private graph duplicates reclaimed only after verification; generated caches retained
in byte-checked archives. All previous225 receipt digests/10 runtime manifests match
read-only; prior accepted journeys not replayed. Exact verdicts, identities, current
archive retrieval and failed machinery attempts:
[`records/2026-10-02-project-terminal.md`](records/2026-10-02-project-terminal.md).

Next: provide identified owned root-backed scratch/profile capacity≥2GiB **plus
headroom** (target≥3GiB); recheck memory/swap and current inputs; execute frozen
v1.3 browser under a fresh ID and rerun the capacity-blocked suite. Preserve the
guard, all baselines/diagnostics and unknown-owner resources. HTTP's relevant
selected inputs still match; rerun only when changed or a new claim requires it.
Ask-shutdown UI/share/move/delete and production Node20/Alpine follow afterward.

## Historical checkpoint — `chat-project-terminal-20261002-f`

User-expanded capacity closes the blocker. **v1.4 HTTP6/6, Chromium47/47,
suite132/132, repo/terminal types, app docs validator/10 controls and whitespace
PASS.** v1.3 e's47/42 failed execution exposes a GET-barrier quota consumed by
preceding PATCH fallthrough. Separately frozen terminal-local method/document
filter holds the current page's effect/open reads; latest then older delivery,
coherent feedback, valid origin LWW and all direct fallback/prefix gates pass.
No intended product defect found; runtime remains selection's candidate.

Read-only closeout reconciles current consumed inputs, old190/225/144/109/87
evidence sets and accepted/failure receipts. a..e diagnostics/archives preserved;
f successful scratch removed after retention. Expanded root~90GiB free, RAM~13GiB
available, swap free; keep profiles root-backed. No schema/migration/dependency,
commit/deploy/publication/live-store/paid-call changes. Exact commands, launcher,
gate correction and evidence: [`records/2026-10-02-project-terminal.md`](records/2026-10-02-project-terminal.md).

Next: freeze genuine Chromium ask-shutdown/resubmit UI (partial-answer reset,
same request ID, exact durable history/opaque recall, retry exhaustion plus settled/
legacy controls) in this fixture before any fix. Project share/move/delete follows;
production Node20/Alpine remains a separately identified environment requirement.
Portable harvest v2.10.0 generalizes the terminal lessons; f's executed v2.9.0
basis and all runtime/gate/receipt bytes remain intact. Current documentation audit:
App `output/chat-project-terminal-resume-20261002/verify-playbook-harvest.mjs`.

## Historical checkpoint — `chat-ask-shutdown-20261002-a`

Resumes terminal f in translate/v2.10.0. **HTTP7/7, actual Chromium31/31 v1,
suite136/136, repo/shutdown types, app docs validator/10 controls PASS**. Frozen
positive gates accept unchanged runtime: genuine shutdown after visible partial,
two cleared content-free held resubmits with identical bodies/stable request ID,
terminal exhaustion, exact history/opaque recall and direct feedback/regenerate.
Healthy settled/legacy, at-send snapshot/new-action ID, actual reload, all acknowledgment/
error/selection/drain controls pass. Four added comparator self-controls reject eight
faults; this is verified evaluation/knowledge work, not a defect repair/reconstruction.

Old gates/baselines/diagnostics and server LWW preserved; no runtime/schema/migration/
dependency changes, commits/deploy/publication/live stores/paid calls. Prior evidence
133/190/225/144/109/87-file sets and10 runtime manifests checked read-only. Successful
scratch removed after retention; root-backed profiles/caches/stderr remain under the
new owned base with~90GiB root free. Retrievable integrated receipt, commands, frozen
bytes and limitations: [`records/2026-10-02-ask-shutdown.md`](records/2026-10-02-ask-shutdown.md),
App `output/chat-ask-shutdown-20261002/integrated-verification.json` when present.

Next: freeze actual owner-share-modal grant/revoke with a second synthetic user,
owner-only management and exact persisted grant/history/recall; fresh list/read/ask/
event-feed admission before/after revoke. Extract open-feed membership-snapshot
semantics before its gate; use acknowledged direct consumers before repairs.
Move/delete, post-done shutdown and production Node20/Alpine remain separate.

## Historical checkpoint — `chat-project-sharing-20261002-b`

Actual owner share-modal direct/group grant, partial/full revoke and regain pass
**HTTP11/11 v1; Chromium25/25 v1.1**, unchanged runtime. Live sidebar, owner-only
management, held member continuation/authorship, exact preserved chat rows/metadata/
opaque memory, fresh admission and changed-rating direct feedback pass. Existing
chat feeds retain connect-time admission; fresh revoke404 is not active-feed revocation.
General ask keeps caller-key access while omitting inaccessible project context.

Browser a25/24 remains failed: global no-GET counted legitimate peer adoption;
regained feedback also clicked an already-selected rating. Separate v1.1 adapter
binds reads to the consumer actor and requires a new changed-rating PATCH/200 plus
HTTP/raw SQLite metadata. HTTP a reused by exact unchanged HTTP-prefix comparison;
all old gates/receipts/diagnostics retained. No product runtime/schema/dependency fix.
Owning receipt: [`records/2026-10-02-project-sharing.md`](records/2026-10-02-project-sharing.md);
App `output/chat-project-sharing-20261002/` when present. Failed scratch
`/var/tmp/cortex-qa-tmp/project-sharing-20261002/chat-journey-bPx2L7` remains;
successful scratches removed after retention, capacity~90GiB and old resources preserved.
Suite138/138, repo/sharing types and App docs validator/10 controls pass; two grant
comparator controls reject five faulty stored sets. Whitespace/current-input/receipt
audit covers the combined HTTP a/browser b candidate; no old journey replay.

Next: freeze actual drag/drop own-chat move into/out of a shared project, consent
cancel/confirm, target membership/author-only management, exact organizational state
and direct selected recall consumers. Project delete/detach follows. Immediate active-
feed revocation needs a separately specified behavior delta; production parity remains open.

## Historical checkpoint — `chat-project-move-20261002-d`

Frozen v1.3 **move HTTP8/8, Chromium23/23 PASS**. Unchanged-page baseline c23/21
rejects exactly rejected-target selection and delayed origin-ack navigation context;
client baseline1/2 rejects hidden404. Small fix only `page.tsx` (success/live-ref
ownership) and `chatHistory.ts` (move404 rejection). Raw organizational rows/metadata/
citations/personality/opaque recall/timestamps, consent and immutable snapshots pass.

Changed runtime justified18 fresh integrated executions: sharing11/25, shutdown7/31,
terminal6/47, selection6/29, continuity7/25, follow-up6/29, project8/23, ask59 HTTP+
six callbacks/Chromium33; every stage passes with retained old gates. Original HTTP
projection and browser held-operation/PATCH-capture failures remain behind the receipt.
Owning record: [`records/2026-10-02-project-move.md`](records/2026-10-02-project-move.md);
App `output/chat-project-move-20261002/` owns exact inputs/commands/closeout when present.
Failed root-backed `chat-journey-{QPm6oT,DDamSr,tVeYCM,B2P5SZ}` diagnostics remain;
successful scratch removed after retention, root~85GiB free. No CAS/schema/migration/
dependency/commit/deploy/publication/live/paid changes; SDK/MCP contracts preserved.
Suite142/142, repo/move types, docs validator/10 controls and whitespace pass;
move-state self-controls reject five losses, client success/rejection tests pass2/2.

Next: actual project deletion/native confirm/explicit detach, all authors' surviving
flat lists/exact chat state, valid held compaction, fresh admission and acknowledgment
after navigation; keep older-schema detach controls. Active-feed instantaneous revoke,
overlapping moves and production Node20/Alpine remain separate scope/decision gaps.

Portable harvest **v2.11.0** generalizes action/actor/attempt-specific evaluations,
admission versus ongoing authority and mutation acknowledgment ownership. d's actual
v2.10.0 execution basis and all runtime/gate/receipt bytes remain unchanged; separate
App move `playbook-harvest-verification.json` validates documentation/current evidence.

## Historical checkpoint — `chat-project-delete-20261003-c`

Translate/v2.11.0, resumes move d. Frozen **delete HTTP9/9, Chromium21/21 v1.1
PASS**; unchanged-page b21/20 rejects only delayed-delete acknowledgment clearing
an unrelated currently selected project. Small page-only pure current-state comparison
repair accepted. Native EN/DE confirm/cancel, complete raw multi-author detach and
unrelated state, author flat lists, fresh admission, held compaction and direct
feedback/edit/regenerate immutable snapshots pass. Legacy explicit-detach control kept.

Fresh20 integrated executions pass: delete9/21, move8/23, sharing11/25, shutdown7/31,
terminal6/47, selection6/29, continuity7/25, follow-up6/29, project8/23, ask59+six
callbacks/33. Suite144/144, repo/delete types, docs validator/10 controls pass.
Browser a7/4 bilingual-driver failure and b positive rejection remain retained.
Owning receipt: [`records/2026-10-03-project-delete.md`](records/2026-10-03-project-delete.md);
App `output/chat-project-delete-20261003/` holds exact commands/inputs and closeout.
Failed root-backed `chat-journey-{X3DD3R,iQcYmJ}` remain; success removed after receipts;
root~82GiB free. No CAS/schema/migration/dependency/commit/deploy/publication/live/paid
changes; LWW, opaque state, request IDs and SDK/MCP contracts preserved.

Next: freeze **pre-commit DELETE transport failure** through an owned actual request
failure; require unchanged state and direct no-refetch selected-project context/recall
with success/cancel controls before fixing rejection propagation. Remote deletion
of a selected non-author chat and its in-flight persistence, instantaneous feed
revocation, overlapping moves and production parity remain separate.

## Historical checkpoint — `chat-project-delete-rejection-20261003-b`

Translate/v2.11.0, resumes delete c. Frozen **Chromium23/23 v1 PASS**; baseline
a23/21 rejects only direct regenerate/edit project context after genuine pre-dispatch
DELETE failures. Exact raw state/no server dispatch/late compaction and all healthy
cancel/success/error/selection/drain controls pass. Page-only catch refresh/early-return
repair accepted; client success/HTTP/transport propagation tests pass3/3 unchanged.

Fresh21 combined runtime executions pass: rejection23, delete9/21, move8/23,
sharing11/25, shutdown7/31, terminal6/47, selection6/29, continuity7/25, follow-up6/29,
project8/23, ask59+six callbacks/33. Suite147/types/docs10 controls pass; Skills lint
and unchanged manifest pass. Owning receipt:
[`records/2026-10-03-project-delete-rejection.md`](records/2026-10-03-project-delete-rejection.md);
App `output/chat-project-delete-rejection-20261003/` owns exact evidence/closeout.
Failed `chat-journey-W3hNlA` retained root-backed; successes removed after receipts;
root~81GiB free. LWW/opaque state/immutable snapshots and prior905+historical evidence
sets preserved. No CAS/schema/migration/dependency/commit/deploy/publication/live/paid changes.

Next: remote owner deletion while a member-owned chat remains selected with held
compaction; exact author-state/admission and direct no-refetch consumers. Separate
non-author selected-chat control must distinguish fresh rejection from ongoing
feed/operation semantics before a stronger lifecycle requirement. Post-dispatch
uncertain response loss, overlapping moves and production parity remain separate.

Current portable guidance **v2.12.0** harvests deletion/rejection, failure-phase,
localized-consent and historical-detach lessons. b retains its executedv2.11.0 basis;
all runtime/gate/receipt bytes are preserved. Documentation-only audit:
App `output/chat-project-delete-rejection-20261003/playbook-harvest-verification.json`.

## Historical checkpoint — `chat-project-remote-delete-20261003-b`

Translate/v2.12.0; frozen **v1.1 HTTP10/Chromium31 PASS**. Baseline browser a31/29
rejects stale deleted project IDs in direct member-author edit/regenerate, with all29
healthy/state/late-compaction/authority/error controls passing. Page-only existing
flat-list refresh selects personal context from positive author-owned association
evidence, retaining local history/recall/snapshots. HTTP a10/9's unsupported literal
event kind corrected separately; healthy HTTP b10/10 precedes runtime repair.

Fresh23 combined executions/suite147/repo+remote types/docs10 controls/Skills lint
and unchanged manifest pass. Exact detach/author access/late memory/LWW retained;
fresh non-author read/save/feed404 remains distinct from admitted ask/relay completion
and open-feed post-detach delivery. Actual non-author browser PATCH404 preserves all
raw storage. No stronger revocation or persistence guarantee inferred.
Owning receipt: [`records/2026-10-03-project-remote-delete.md`](records/2026-10-03-project-remote-delete.md);
App `output/chat-project-remote-delete-20261003/` contains the integrated audit.
Failed root-backed `chat-journey-{7tUWNI,qXWoVG}` retained; successes removed only
after receipt retention. Root~79GiB; all prior evidence/shared resources untouched.
No CAS/schema/migration/dependency/commit/deploy/publication/live/paid changes.

Next: freeze old personal flat-list response delivery across acknowledged own-chat
move into a shared project and navigation to another selected project chat. Direct
edit/regenerate must retain current association/history/recall/immutable snapshot,
with healthy current-list/remote-delete controls before fixes. Uncertain post-dispatch
response loss, stronger non-author lifecycle policy and production parity remain separate.

## Historical checkpoint — `chat-project-association-list-20261003-c`

Translate/v2.12.0; frozen **Chromium27/27 v1.1 PASS**. b27/25 rejects two direct
context losses after genuine old personal-list delivery: acknowledged move/newer
refresh and navigation where the held list remains latest. Page-only latest-request
and dispatch-view/selection guards preserve exact state/late compaction/immutable
memory/prefix/personality/no-GET consumers. a unsupported memory-only notification
trigger remains a failed adapter attempt; v1.1 healthy controls run before repair.

Fresh24 combined stages/suite147/types/docs10 controls/Skills lint+unchanged manifest
pass. Remote author/non-author distinctions, mutation rejection/late-ack gates and
LWW preserved. Owning receipt:
[`records/2026-10-03-project-association-list.md`](records/2026-10-03-project-association-list.md);
App `output/chat-project-association-list-20261003/` holds the integrated audit.
Failed root-backed `chat-journey-{BGZXZc,DyxLfl}` retained; successes removed only
after receipts; root~77GiB. No schema/migration/dependency/CAS/commit/deploy/publication/
live/paid changes; all old gates/evidence/unknown-owner resources untouched.

Next: forward genuine native-confirm DELETE, retain committed detach, then fail
its response delivery with selected author held compaction. Freeze caller-failure/
authoritative-state/list reconciliation/direct immutable consumers/late memory/no
automatic replay separately from pre-dispatch rejection and acknowledged success.
Broader list schedules, stronger non-author revoke policy and production parity remain open.

## Historical checkpoint — `chat-project-delete-response-loss-20261003-a`

Translate/v2.12.0; frozen **Chromium26/26 v1 PASS**, unchanged runtime. Actual DELETE
forwards/commits with real200/raw detach before response delivery aborts; caller
requestfailed/no ack remains separate from authoritative state. List reconciliation,
valid late memory/direct immutable personal-context consumers and no automatic replay
pass. Native cancel/pre-dispatch-no-commit/acknowledged-success controls distinguish phases.

One fresh journey +association c's24 accepted stages/147-test result integrate only
after complete current source/dependency/evaluator/tool/receipt reconciliation. Old
stages were not re-executed or relabeled. Fresh types/docs10 controls/Skills lint and
unchanged manifest pass. Owning receipt:
[`records/2026-10-03-project-delete-response-loss.md`](records/2026-10-03-project-delete-response-loss.md);
App `output/chat-project-delete-response-loss-20261003/` holds the aggregate. Success
scratch removed after receipts; root~77GiB; old failures/evidence/shared resources kept.
No new runtime/CAS/schema/migration/dependency/commit/deploy/publication/live/paid change.

Next: overlapping own-chat moves to two targets, actual commit A then B/200, older
A acknowledgment delivered last. Freeze exact state/direct selected immutable
consumers plus navigation/single-move controls; preserve LWW/both accepted outcomes.
Do not infer latest-start-wins, instant revocation or all uncertain-outcome coverage.

## Historical checkpoint — `chat-project-move-overlap-20261003-c`

Translate/v2.12.0; frozen **v1.1 Chromium21/21 PASS**. b21/19 rejects exactly direct
regenerate/edit stale A context while commits A/B and acknowledgments B/A leave
storage B. All19 other healthy/state/late-memory/order/ack/error controls pass.
Page-only fresh positive project membership selects context under existing request/
session/view guards; move success awaits existing refresh instead of binding its target.
No new GET/ref/CAS/schema/migration/dependency or gesture-order rule; LWW/snapshots kept.

Fresh26 combined journeys/suite147/types/docs10 controls/Skills lint+unchanged manifest
pass, with delegated evaluator and independent read-only review. v1 a overlay failure/
incomplete16/15 and both frozen versions/failed scratchs retained. Owning receipt:
[`records/2026-10-03-project-move-overlap.md`](records/2026-10-03-project-move-overlap.md);
App `output/chat-project-move-overlap-20261003/` holds integrated audit/review receipts.
Failed root-backed `chat-journey-{AyIdSl,02W48p}` kept; successes removed after receipts;
root~75GiB. No commit/deploy/publication/live/paid change; earlier evidence untouched.

Next: new gate holds native A pre-forward, dispatches/commits/acks B, then releases
A to commit/ack last. Require observed B→A storage and direct immutable context A,
valid late memory/healthy controls/both accepted outcomes. Reverse commit order
remains unexecuted; current gate also passes latest-gesture selection, which the
chosen repair does not encode. Broader list/authority/production gaps stay separate.

Current portable guidance **v2.13.0** harvests association/request/view ownership,
commit-versus-ack order, post-commit delivery failure, notification/overlay/barrier
adapter fidelity and independently corrected review claims. c retains its executed
v2.12.0 basis and all original26 results/gates/failures. Documentation-only audit:
App `output/chat-project-move-overlap-20261003/playbook-harvest-verification.json`.

## Current checkpoint — `chat-project-move-reverse-20261003-b`

Translate/v2.13.0; frozen **reverse v1.1 Chromium21/21 PASS**, unchanged product.
Actual native A held before forwarding has no commit/response/move ack; B commits/
browser200 while A held, then A forwards/commits/browser200 last. Observed commits
B→A and final storage/direct edit/regenerate context A with distinct instructions,
exact move-only state/valid held compaction/immutable pre-turn memory and personality
association pass. Both accepted outcomes/LWW retained; no runtime fix warranted.

One fresh journey +26 explicitly inherited unchanged-input c executions; source/
evaluator/helper/installed-lock/tool/receipt identity checks, not timestamps, justify
reuse. v1 a12/8 evaluator false positive counts prior origin history-save ack; new
chat+target predicate/null phases corrected separately, old gate/receipt/scratch
`chat-journey-990zdZ` retained. Its teardown releases A and can change scratch DB;
pre-abort captured state owns the earlier no-commit evidence. Read-only reviewer
accepts b and records both missed evaluator bugs/corrections. Final local gates and
exact integrated result owned by [`records/2026-10-03-project-move-reverse.md`](records/2026-10-03-project-move-reverse.md),
App `output/chat-project-move-reverse-20261003/`. c's executedv2.12.0/original26
receipts/failures stay immutable. No schema/migration/dependency/CAS/commit/deploy/
publication/live-store/paid changes. Capacity floor remains2GiB with owned profiles.

Next: hold genuine positive B project-list response after B commit/ack with A still
unforwarded; release A to commit, capture/deliver newer positive A response, then
deliver older B last. New gate/IDs require direct immutable/no-chat-GET context A,
exact state/valid compaction/healthy controls before any fix. This list-delivery
combination remains unexecuted; neither tested schedule establishes all list orders.

## Release readiness — `release-readiness-20261003` (App-led, 2026-10-03)

The uncommitted Chat delta (page turn-ownership/persist, chat-events, chatHistory,
ask stream route + evaluation harness/docs) passed a production-actual boot smoke
on the built Node20-Alpine image `be922861`: gate v1.2 run c **63/63 exit0**
(login, personal ask, late-memory durability, reload/replay through the real
broker, unchanged move/delete browser gates, source↔image binding 219/219,
tripwire clean). Suite147 + typecheck pass in a Node20-Alpine container with git
(provenance tests need historical blobs — CI checkout needs `fetch-depth: 0`).
Run b's Secure-cookie login failure was an evaluator artifact (Playwright
URL-filtered query omits Secure cookies over http; production requires HTTPS);
v1.2's dual-mode capture proves attribution with zero browser injection.
Non-claim: the smoke image set `NEXT_PUBLIC_SENTRY_DISABLED=1` (GHCR parity);
the source-default reporting-enabled build needs one boot smoke against an owned
sink before a source-built push. Verdict/runbook/checkpoints live in App
`output/release-readiness-20261003/` (VERDICT.md, HANDOFF-source-built.md) and
App `qa/NEXT_SESSION.md`. No commit/push/deploy; dirty tree preserved.

## Honest gaps (live / unobserved)

- Selected Chromium Chat UI evidence now exists; LLM/voice/IdP and other browser
  journeys remain unobserved. Real isolated backend
  integration for restored read/login HTTP journeys is linked above; it does not
  establish a deployed production stack or a live ask/model journey.
- Autoload of `CLAUDE.md` by Claude Code is documented expectation, not observed delivery.
- Active-WAL/online snapshot consistency remains unverified; current fixture closes
  and checkpoints every writer before capture and refuses journal sidecars.

## Source-built pre-push closeout — 2026-10-03

App-led source-default Chat build (no `NEXT_PUBLIC_SENTRY_DISABLED` or public DSN
override) image `1f53581d` passed fresh evaluator v1.1 run
`chat-source-default-20261003-b`: **13/13, exit0**, fixture boot/readiness/genuine
Chromium login/Secure cookie identity/config, reporting enabled to owned local
server/browser telemetry sink, clean tripwire and retained bounded shutdown.
Independent read-only review ACCEPT. Run a's invalid synthetic DSN setup failure
remains failed with stopped container/scratch; the separate v1.1 file changes only
that key. Frozen production-v1.2 closure remains byte-identical; old journeys
were neither edited nor rerun. CI `contract-tests` checkout now has
`fetch-depth: 0` for historical-blob provenance tests.

Evidence/runbook supplement: App
`output/release-readiness-20261003/CLOSEOUT-source-built-20261003.md` when present;
App `qa/NEXT_SESSION.md` owns continuation. Supported config endpoint is
`/api/config`, identity `/api/auth/me` (old handoff `/api/auth/config` is a typo).
Commit/backup/push/source-rebuild/HTTPS deployment smoke still require explicit
user authorization and target/access references; no such action/live access has
occurred. All old dirty-document bytes preserved by append-only update.

## Authorized publication / playbook harvest — 2026-10-03

User authorized commit/push of the three companion repos to `main` after the
App technical changelog and portable **v2.14.0** harvest. Backups are covered by
the user's separate routines; no instances auto-deploy on push. Git publication
does not claim an HTTPS deployment smoke. Historical executed playbook/gate
bases and failed receipts remain unchanged; the harvest changes guidance only.
New publication/docs-gate receipts are App
`output/release-readiness-20261003/authorized-publication-20261003/` when present.
The post-publication next slice remains delayed positive project-list ordering.
