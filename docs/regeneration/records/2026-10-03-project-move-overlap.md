# Overlapping moves / commit truth / selected context — 2026-10-03

Checkpoint **`chat-project-move-overlap-20261003-c`**, translate / playbook
**v2.12.0**, resumes **`chat-project-delete-response-loss-20261003-a`**. App `bd6c1e0`,
Chat `40fe797`, Skills `1156ade`; dirty work preserved. Frozen **v1.1 Chromium21/21
PASS** after baseline b21/19 rejects two stale selected-context values. Runtime delta
only Chat `src/app/page.tsx`; server state/protocol/LWW remain unchanged.

## Intent and actual order

Two overlapping successful moves retain their accepted outcomes. Storage association
follows observed commit order, not gesture or acknowledgment delivery order. An
older successful response cannot rebind the selected chat to an association already
superseded in storage. Keep every other raw session/message field, metadata/citation
sid, opaque recall, personality, attribution and recency; valid originating late
compaction and immutable edit/regenerate snapshots remain eligible.

Gate `scripts/chat-project-move-overlap-{checks,journey}.ts`, types
`scripts/tsconfig.chat-project-move-overlap.json`, reuses the isolated real Next dev/
migrated synthetic SQLite/crypto/held-loopback/Chromium fixture. Real owner form login
and member HTTP admission control, native EN/DE consent/cancel, single acknowledged
move and acknowledgment-after-navigation controls are required. HTTP/readonly SQLite
observations never inject state into the selected page. The dedicated HTTP surface
is not-run: the response-delivery schedule is browser-specific.

1. A selected own-chat turn is done-visible with compaction held. Native move A is
   forwarded; capture genuine200/`{ok:true}` after commit A and retain full raw state.
   Hold that real response from the browser, with no A acknowledgment yet.
2. The same page performs native move B. Its real commit B and browser200 occur
   while A remains held. Raw comparison proves only `project_id` changes A→B.
3. Deliver A's older acknowledgment last: real acknowledgment order B→A, actual
   commit order A→B, final stored association B. No rejected/replayed writes, CAS,
   latest-start-wins or merged-history rule is introduced.
4. Release valid late compaction; exact origin history/recall save retains association B.
   Direct regenerate/edit use B with the original immutable pre-turn blob, exact
   displayed prefix/personality and no repairing browser chat GET. Each redo settles.

Capture/commit/browser acknowledgment are separate evidence. Holders reserve once,
filter by actor/method/target before await, record intercepted PATCHes and genuine
response bytes, and correlate held redo requests with actual upstream IDs. A new
matching server-log line after the pre-A offset is diagnostic; raw response/SQLite
are primary commit evidence. All10 attempted writes have200 acknowledgments; exactly
four move attempts (single, navigation, A, B), no transport failures, complete
selection/page/crash/unhandled/tripwire/drain/input-drift/retention gates required.

## Attempts and smallest repair

| Attempt | Executed verdict |
|---|---|
| Browser a, v1, unchanged runtime |16 selected/15 pass, exit1/incomplete: native drags leave sidebar open; overlay intercepts first regenerate hover, no intended value assertion reached |
| Browser b, v1.1, unchanged runtime |21/19, exit1: exactly regenerate/edit consume A instead of observed B; all19 healthy/state/order/late-memory/ack/error controls pass |
| Browser c, v1.1, candidate |21/21 PASS, exit0 |

`GATE-CORRECTION.md` retains the failed overlay case and v1 bytes. v1.1 closes the
real sidebar and waits two committed frames before message consumers, including
the navigation case. This changes visibility only, not refs/storage/GETs. No value,
order or bound weakened; revised gate executes on unchanged runtime before repair.
Baseline b's context comparison precedes its remaining snapshot clauses, so those
clauses are not independently demonstrated by the failed row; c checks the full gate.

Fix: after acknowledged move, await the **existing** guarded sidebar refresh rather
than bind the callback's target. Its latest project-list response selects context
only on positive membership of the captured selected session, with the existing
view/session/request guards. Positive author-flat clearing stays. Absence alone
changes nothing. No new endpoint/GET/ref/state owner, persistent coordination/CAS,
schema/migration/dependency or App/SDK/MCP runtime change. History and local retry
snapshots are never reloaded or replaced by this association projection.

Context is latest completed authoritative-list evidence, not a realtime/distributed
guarantee. This schedule also passes a latest-gesture rule because gestures and
commits both occur A→B; the chosen repair contains no such rule. Reverse commit order
of gestures is explicitly **unexecuted**. Broader list schedules, failed reconciliation,
instant active-feed/non-author revocation and production parity remain separate.

## Delegation and integrated verification

User requested subagents. Evaluator writer owns only the three new scripts; an
independent reviewer is read-only; lead owns runtime/evidence/docs/combined result.
All received root/scoped instructions, accepted checkpoint/version, exact owned paths,
required controls, constraints and stop conditions. Pre-freeze construction defects
were corrected separately from executed failures. Independent review confirms b's
two value rejections, c's two-hunk page-only repair and all26 combined executions.
Reviewed corrections/limitations are retained in App `delegation.md` and
`independent-review.md` under the evidence entry below; not instruction-autoload proof.

Changed page warranted **26 fresh final runtime executions**, all exit0:
overlap Chromium21; association27; response-loss26; rejection23; remote HTTP10/31,
delete9/21, move8/23, sharing11/25, shutdown7/31, terminal6/47, selection6/29,
continuity7/25, follow-up6/29, project8/23, ask59 HTTP +six callbacks /Chromium33.
Suite **147/147,0 fail/skip/cancel**, repo/overlap types, App docs validator and
10/10 controls PASS. Skills lint two existing warnings/manifest before/first/second
byte identity PASS. Dark DE cancel and EN settled screenshots inspected.

## Replay, evidence and resources

From Chat, owned root-backed TMPDIR and the existing recorded launcher:
`node --import tsx scripts/chat-project-move-overlap-journey.ts <fresh-output> <fresh-id>`.
Types: `node node_modules/typescript/bin/tsc --noEmit -p scripts/tsconfig.chat-project-move-overlap.json`.
App-relative **`output/chat-project-move-overlap-20261003/`** retains full start/
baseline runtime/before-knowledge, both frozen gate versions, original failures/
diagnoses, candidate page/manifest, real request/ack/order/state/consumer bodies/
dialogs/logs/console diagnostics/screenshots, all26 final receipts/local checks and
one-shot `verify-evidence.mjs` / `integrated-verification.json`. Every invocation/
exit/log hash is retained in `*-command.json`. `verified-inputs/` additionally
retains unchanged executed evaluator bytes after execution-hash equality (post-
execution retention, not replay). Full per-run runtime/scenario hashes own identity;
older ask adapters' lack of gate-snapshot is not substituted by mtimes.

Owned base `/var/tmp/cortex-qa-tmp/project-move-overlap-20261003/` retains
**`chat-journey-AyIdSl`** (overlay failure) and **`chat-journey-02W48p`** (positive
baseline), with source/SQLite/log/private graph/.next/browser diagnostics. Success
removed only after actual receipt retention; root~77GiB initially/~75GiB after
checks, RAM~13GiB available/swap~9GiB free; unchanged2GiB floor kept. Previous
response-loss311/association1030/remote1003/rejection891/delete905/move697 and all
earlier evidence/failed scratch/archives are preserved read-only. Shared/unknown-
owner and preexisting runtime resources untouched.

Actual Node22.22.3/Next16.1.7/React19.2.4/better-sqlite3-12.9.0 dev; existing
external Playwright-core1.63.0/Chromium153 revision1243, renderer2/JS512MiB launcher
`output/chat-project-terminal-20261002/diagnostic-chromium.sh`, root-backed stderr/
profiles, no installs. Clean app hooks do not prove browser-background/OS egress
confinement. No commit/deploy/publication/live-store/paid call, model-quality,
production Node20/Alpine, replacement/reconstruction or release-ready claim.

## Harvest and precise next action

Owning streaming/storage/QA guides, public feature/handbook source (unreleased
candidate) and all three checkpoints updated. Portable guidance remainsv2.12.0;
existing authority/view/phase principles apply. Fixture reuse and disjoint delegation
were exercised; overall change-cost savings remain a hypothesis.

**Next bounded action:** freeze reverse commit order of the same two gestures.
Hold actual native PATCH A **before forwarding**, dispatch B and prove commit B/
browser200, then release A to forward/commit/ack last. Observe commits B→A and
final association/current direct edit/regenerate context A, full move-only state,
valid late compaction and immutable snapshots, with healthy controls and both
accepted outcomes. Use a new gate version/ID, preserve current A→B/B→A evidence,
and do not convert expected commit truth into a latest-gesture or CAS rule.

## Portable harvest after execution

Playbook **v2.13.0** generalizes the session's lessons at their existing owners:
§4.3 checks reviewer causal/discrimination claims and records corrections; §7.3
separates admitted completion from a later save's authority; §9.1 traces actual
branch-specific notification effects and optional event fields; §9.2 verifies real
post-commit response-loss phases and operation-local diagnostics; §9.4 distinguishes
dispatch/commit/ack schedules with an explicit reverse-order case-design table;
§9.5 covers overlays, mode-correct barrier completion and once-only reservation;
§9.6 preserves healthy rows and unexecuted conjuncts on failed runs; §12.3 uses
content identities/inherited execution labels rather than mtimes; §13.3 derives
positive authoritative association while guarding both latest read and selected
view, without inventing absence/revocation or mutation-order policy. §21 adds symptoms.

Current three-repo guidance and continuation pointers usev2.13.0. **c's executed
v2.12.0 basis and original body above**, all runtime/evaluator bytes, original26
results and historical failures remain intact. This documentation-only harvest
adds no journey, replacement, reconstruction, production or instruction-autoload
claim. Before-knowledge snapshots and separate integrity/current-input audit:
App `output/chat-project-move-overlap-20261003/verify-playbook-harvest.mjs`,
`playbook-harvest-before.json` / `playbook-harvest-before/`, and
`playbook-harvest-verification.json`. The original execution closeout is immutable;
the reverse-commit gate remains the next unexecuted action.
