# Delayed positive project-list ordering — 2026-10-03

Checkpoint **`chat-project-move-positive-list-20261003-b`**, translate / playbook
**2.14.0** (no separate harvest; scoped reusable learnings live in the owning
guides and this record), resumes **`chat-project-move-reverse-20261003-b`**.
Published HEADs (user-provided, publication complete): Chat `d6d3ad6ececf…`,
App `85e29fedd00a…`, Skills `63e37ec29d82…`. Frozen **project-move-positive-list-v1.1
Chromium26/26 PASS, exit0** on **unchanged published Chat runtime**. No claimed
product defect and no runtime fix: the only executed rejection was an evaluator
lifecycle false positive, corrected in the gate before the accepted run.

## Why and what must hold

The reverse schedule proved observed commit truth (commits B→A, acks B→A, final
context A) but its acknowledgment and commit orders coincide; it cannot exercise
list-delivery ordering. This slice freezes the delayed **positive project-list**
combination: an older genuine list response containing the selected chat
positively in B is captured while A is still unforwarded, held, and delivered
**LAST** — after A's commit/acknowledgment and after a newer genuine A-positive
list has been delivered. A page that selects context from the last-delivered
list binds B here and its direct consumers are rejected; request/view-owned
selection keeps A. Both moves stay accepted under unchanged atomic
full-snapshot LWW; no latest-start-wins, latest-gesture, CAS, stale-write
rejection or merged-history rule is asserted or implied. Full move-only
session/message preservation, valid originating late compaction and direct
immutable edit/regenerate consumers are retained.

## Executed schedule (frozen v1.1)

New scripts `chat-project-move-positive-list-{checks,journey}.ts`, types
`tsconfig.chat-project-move-positive-list.json`, reusing the unchanged isolated
runtime/browser/move-comparator/fixture helpers. Native EN moves into two
shared targets with distinct instructions; real form login; DE native cancel;
acknowledged single move; held-ack navigation consumer; auxiliary notification
trigger controls. HTTP/SQLite reads are observational and never feed page state.

1. Native move A is captured **before route.fetch** (no dispatch, no commit, no
   acknowledgment; exact unchanged full state; operation-local pre-A log has no
   matching PATCH — no-ack predicates bind chat AND projectId, excluding the
   earlier accepted origin-history save).
2. Native B commits (`{ok:true}`, move-only SQLite) and the browser 200 arrives
   while A remains unforwarded; exactly one B dispatch in the pre-release log
   segment. The page's own genuine `GET /api/me/projects` response containing
   the selected chat **positively in B** (and excluding A membership) is
   captured with real bytes after commit B and B's acknowledgment, and HELD.
3. A is released: forwards, commits last, is acknowledged last (B ack < A ack).
   A newer genuine A-positive list (excluding B membership) captured after A's
   committed response/acknowledgment is **delivered**. Then the held older
   B-positive response is delivered LAST; nothing else may be delivered after
   it before the consumers are judged.
4. Scoped **unavailable-refresh window**: after the old delivery, every further
   genuine project-list response is still captured with real bytes but its
   delivery is **failed with an actual `route.abort("failed")`**. This is
   necessary, not cosmetic: `persistSession` chains `.then(refreshSessions)`,
   whose `listProjects()` await would never resolve under an indefinite hold,
   deadlocking the queued regenerate/edit saves. The page's documented guarded
   refresh catch resolves the write queue while furnishing **no repairing
   association**. Failure accounting is phase-local: in-window failures must be
   either the projects-list expected aborts (each matched to its exact
   intercepted Request object/sequence via identity WeakMap) or selected-chat
   events cancellations one-to-one matched to an actual instrumented
   `EventSource.close()` (see correction); pre-window native cancellations are
   retained diagnostics, never a whole-session network-health claim.
5. Direct regenerate/edit consume the observed final association A (its
   injected instructions present, B's absent), the original immutable pre-turn
   memory, the exact displayed prefix and the retained assistant association
   with **no chat GET** from before the old delivery through the first
   held-redo dispatch (second consumer keeps its own pre-dispatch window); both
   settle with exact expected stored state. Valid held late compaction saves
   origin history/recall with association A. Healthy controls: dark EN/DE,
   native DE cancel, single move, held-ack navigation, bounded-absence auxiliary
   messages+memory-trigger vs memory-only-no-trigger, acknowledgments (all
   writes 200, exactly four move attempts), selection/page-error/blocked/
   tripwire/drain/finalize.

## Evaluator false positive and v1.1 correction

| Attempt | Executed verdict |
|---|---|
| a, frozen v1, unchanged runtime | 26 selected/25 pass, exit1; sole failed check `browser.no-repairing-list-after-old-b` rejects two in-window `GET /api/me/chats/<selected>/events` `net::ERR_ABORTED` |
| b, frozen v1.1, unchanged runtime | 26/26 PASS, exit0; complete schedule/state/consumer/control gate |

a's two records are the page's own selected-chat feed cancellations: the
`isLoading`-dependent events effect suspends during own streaming and its
cleanup `es.close()` runs at each redo's loading teardown (regenerate closes the
pre-redo idle feed; the settle re-creates it; edit's teardown closes the
regen-settle feed). v1 required every in-window failure to be a projects-list
abort — a lifecycle false positive, **not a product value rejection**. v1.1
instruments every actual `EventSource` (unique page-local seq,
created/open/error/close times, `closeInvoked`) in `__followupFeeds`, snapshots
the live browser close records **before** judgment as the phase proof (never
later retained SQLite), and permits an in-window selected-feed `ERR_ABORTED`
only when one-to-one matched (time-ordered, ≤2s transport delay) to an actual
intentional close of that exact URL; closes without an observed failure remain
retained diagnostics. Old a lacks close timestamps, so it cannot be rejudged
under v1.1; original a bytes/receipt/scratch stay failed and untouched. The
preliminary review claim that old a already "passes 26/26 under v1.1" was
unsupported and is not adopted (`GATE-CORRECTION-v1.1.md`).

b's retained correlation evidence: window capturedResponses 3 (all
failed-not-delivered, real bytes retained, each with exactly one correlated
`requestfailed`), permitted selected-chat events cancellations 2 matched to
close seq 3 and 4 (delays 8ms and 7ms), `closesWithoutObservedFailure` empty;
pre-window diagnostics retained verbatim (2× `GET /` reload cancels, 7×
`/api/me/events` user-feed resubscribe closes). Direct consumers dispatched
from the moved chat's selected view with project A in both redo bodies; commit
samples order B→A; final association A.

## Integration status and verification

**Provenance: 1 fresh b journey; 27 inherited unchanged-input journeys** — 26
explicitly inherited reverse-era executions plus 1 fresh reverse b — reconciled at
campaign start by the read-only preflight (`preflight/`), with reviewed publication
staging manifests 174/174, HEAD blobs 174/174, frozen production-v1.2 closure
11/11, Chat build binding 222/222, overlap 1121 / reverse 359 prior evidence
files, frozen evaluator gates 16/16. Lock identity distinction: the preflight
alone reconciles the **repo** `package-lock.json`; the campaign start's
inherited() checks verify the **actual installed** lockfiles (installed
`.package-lock`) — the stronger installed-lock identity — together with Node
v22.22.3 / npm 10.9.8 / playwright-core 1.63.0 / Chromium 153 rev 1243 /
launcher identities. Historical **production image smoke 63/63**, **telemetry
13/13** and the completed three-repo publication are cited history — none
replayed. No runtime, schema, migration, dependency, CAS, commit, push,
deployment or paid-call change in this slice.

**Final local checks: lead's closeout receipts present and passed** — v1.1 b
**26/26 exit0**, both frozen-gate typechecks (`freeze-types-v1{,1.1}.log`, exit0),
contract suite **147/147, 0 fail/skip** (`chat-suite.log` exit0), repo
`npm run typecheck` exit0, docs validate OK (31 pages) and docs controls
10/10 exit0 (`local-checks.json ok:true`). Independent execution review **ACCEPT
b**: the one-to-one EventSource close correlation held at delays 8ms/7ms with no
late errors. These receipts are the lead's own, consumed read-only; the lead's
integrated closeout/verdict remains lead-owned.

## Replay, evidence and resources

From Chat with a fresh output/ID and the existing owned base:

```bash
TMPDIR=/var/tmp/cortex-qa-tmp/project-move-positive-list-20261003 \
CHAT_BROWSER_CHROMIUM=../cortex-app/output/chat-project-terminal-20261002/diagnostic-chromium.sh \
node --import tsx scripts/chat-project-move-positive-list-journey.ts <fresh-output> <fresh-id>
node node_modules/typescript/bin/tsc --noEmit -p scripts/tsconfig.chat-project-move-positive-list.json
```

Frozen gate bytes v1/v1.1, both typecheck receipts, delegation, preflight
reconciliation, gate reviews (v1 construction ACCEPT, v1.1 ACCEPT FOR FREEZE
with the corrected replay claim), `GATE-CORRECTION-v1.1.md`, a/b full
receipts/`*-command.json`/logs, and raw request/response/close/list
observations live in App-relative `output/chat-project-move-positive-list-20261003/`.
Failed scratch `/var/tmp/cortex-qa-tmp/project-move-positive-list-20261003/chat-journey-Ml4Ath`
retained; successful b scratch removed only after receipt retention; capacity
~37–41GiB above the 2GiB floor; shared/unknown-owner resources untouched.

## Precise next action

**Recovery prerequisite P3 is now PROVEN** (App
`output/chat-project-move-positive-list-20261003/recovery-dns-preflight/RECEIPT.md`):
a fresh owned disposable private rootless Podman engine proved private
named-network DNS end to end — the client resolved the service name via the
network DNS server (`Server: 10.111.77.1:53`) and fetched
`http://rdp20261003-server/fixture.txt` returning the exact fixture bytes,
with an NXDOMAIN negative control proving discrimination. Only a **fresh
prerequisite** remains (recreate the proven recipe, not a re-litigation);
`CORRECTIONS.md` is impending and must record that a process-0 exit inside the
failed v1 DNS composite was not a semantic pass — the v2 positive run is the
sound evidence. Remaining recovery **decisions** (not gate work): choose the
production/CI-paired restore-consumer target (P2), name the live-WAL/online
snapshot mechanism and user backup-mount coverage (P4/P5), supported upgrade
pairs (P6) and deployment identity for the HTTPS smoke (P7). No repeat of K or
the release gates. **Exact next actionable safe backlog: SDK/MCP protocol
evolution** — freeze a CRLF fragmented-frame positive gate before any repair,
bind the MCP advertised package version reconciliation and add file-thread
persistence-restart coverage, with no new dependencies. Broader list schedules,
other uncertain post-dispatch outcomes, instantaneous open-feed revocation and
production Node20/Alpine parity remain separate scope/decision gaps.
