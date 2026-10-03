# DELETE committed / response lost / caller reconciliation — 2026-10-03

Checkpoint **`chat-project-delete-response-loss-20261003-a`**, translate / playbook
**v2.12.0**, resumes **`chat-project-association-list-20261003-c`**. App `bd6c1e0`,
Chat `40fe797`, Skills `1156ade`; dirty work preserved. Frozen **v1 Chromium26/26
PASS on unchanged runtime**. No new product fix: this is verified evaluation/
knowledge work, with association c's page request/view guards retained.

## Intent and actual fault phase

A missing DELETE acknowledgment does not prove rollback. Keep the caller's transport
failure distinct from authoritative state and permitted selected-view transitions.
If deletion committed, exact author-owned detach, valid late memory and immutable
direct consumers must survive; a supported list refresh can reconcile personal
context without retrying DELETE. If the request never dispatched, state/project
context remain. Healthy consent/cancel and acknowledged success distinguish both.

`scripts/chat-project-delete-response-loss-{checks,journey}.ts`, types
`scripts/tsconfig.chat-project-delete-response-loss.json`, reuse the established
isolated real Next dev/migrated synthetic SQLite/crypto/held-loopback/Chromium
runtime. One real owner form login and member HTTP login create two authors' chats,
with rich metadata/citation sid, pin, personality and opaque recall. External HTTP/
readonly SQLite observations never feed expected state into the selected browser.

Two independent own-chat cases (direct regenerate / edit-last):

1. A selected local answer is done-visible while its compaction remains genuinely held.
2. Native confirm starts the actual DELETE. The interceptor **forwards** using
   `route.fetch()`, captures real200/`{ok:true}`, and holds delivery. Full raw state
   must equal explicit project/share removal + `project_id:null`, with every other
   session/message field and unrelated resource unchanged. The actual server log
   records200 while the browser has no acknowledgment.
3. Only then does the interceptor `route.abort("failed")`. Chromium emits the real
   DELETE `requestfailed` / `net::ERR_FAILED`; browser200 acknowledgment is absent.
   The committed detach remains exact. This simulates lost response delivery, not
   a server rollback or pre-dispatch abort.
4. The page's existing post-failure lists reconcile the disappeared project/own flat
   chat. Current URL/history remain; another author's detached chat is not acquired.
5. Release valid origin compaction: exact matching history/blob save stays eligible.
   Direct regenerate/edit consumes original pre-turn recall/prefix, retained soul
   and personal context without a repairing chat GET; each real redo settles.

Native DE/EN cancel controls mutate nothing. A separate pre-dispatch actual abort
never calls fetch/continue, leaves exact state unchanged and has no server DELETE
log; direct redo retains project instructions. A real acknowledged successful DELETE
in the **same log** detaches exactly and direct redo uses personal context.
All four DELETE paths have exactly one attempt: one healthy200, one known
pre-dispatch failure and two post-commit delivery failures. Every other browser PATCH
has200; all page/crash/unhandled/app-tripwire/required-selection/drain gates pass.
Network-console errors are retained separately, not used to exempt runtime errors.

The evaluator knows commit from the captured response and raw state. The caller's
missing acknowledgment alone does not establish that knowledge. This gate does not
cover every uncertain dispatch outcome, unavailable reconciliation, distributed
transactions, production timing or instantaneous non-author revocation. No automatic
DELETE replay was observed; stable correlation IDs are not an idempotency guarantee.

## Verdicts and integrated applicability

First frozen v1 execution **a26/26, exit0**, no gate correction or runtime patch.
Fresh repo/loss types, App docs validator/10 controls, Skills lint (two existing
warnings) and before/first/second manifest byte identity PASS.

Association c's **24 accepted journeys and147/147 suite result** are retained,
not re-executed. Whole runtime manifests, installed graph lock, each old scenario's
complete recorded input closure, launcher/binary and required receipt selection
are rechecked against the unchanged current inputs. This combines **one fresh
response-loss journey +24 unchanged-input accepted journeys**, without relabeling
old runs as new or replaying historical IDs. Owning aggregate:
App `output/chat-project-delete-response-loss-20261003/integrated-verification.json`.

Dark DE native-cancel and EN settled screenshots inspected. No App/SDK/MCP runtime,
CAS/schema/migration/dependency change, new state owner or protocol; LWW, opaque
memory, stable IDs and immutable snapshots remain. No SDK/MCP execution claim.

## Replay, evidence and resources

From Chat with owned root-backed TMPDIR and the existing launcher:
`node --import tsx scripts/chat-project-delete-response-loss-journey.ts <fresh-output> <fresh-id>`.
Types: `node node_modules/typescript/bin/tsc --noEmit -p scripts/tsconfig.chat-project-delete-response-loss.json`.
App-relative **`output/chat-project-delete-response-loss-20261003/`** contains
start/full runtime/before-knowledge snapshots, frozen gate bytes, raw final receipts,
actual request/ack/failure/commit/list/consumer observations, native dialogs, server
logs/network-console diagnostics/screenshots, exact command exits/log hashes and
the one-shot `verify-evidence.mjs` / integrated report. Executed gate snapshots and
post-execution `verified-inputs/` copies have byte equality to execution manifests.
An integrity audit is not another behavioral replay.

Previous association1030/remote1003/rejection891/delete905/move697 and all earlier
evidence/failed diagnostics remain retrievable and unchanged. Before-knowledge
snapshots preserve association's checkpoint; its original executed verdicts remain.
Owned base `/var/tmp/cortex-qa-tmp/project-delete-response-loss-20261003/`:
successful scratch `chat-journey-eUjBsT` removed only after actual receipt retention,
launcher stderr retained; no failed attempt to reclaim. Root~77GiB free,
RAM~13GiB available/swap~9GiB free; unchanged2GiB floor maintained. Association
failed `chat-journey-{BGZXZc,DyxLfl}`, remote/rejection/delete/move/sharing/terminal
scratch/archives and shared/unknown-owner resources remain untouched.

Actual Node22.22.3/Next16.1.7/React19.2.4/better-sqlite3-12.9.0 dev;
external Playwright-core1.63.0/Chromium153 revision1243, existing renderer2/JS512MiB
launcher `output/chat-project-terminal-20261002/diagnostic-chromium.sh`, no installs.
Application tripwires do not establish browser-background/OS-egress confinement.
No commit/deploy/publication/live-store/paid call, model quality, production parity,
replacement/reconstruction or release-ready claim.

## Harvest and next remaining action

Streaming/storage/QA guides, public feature/handbook source (unreleased candidate)
and three-repo checkpoints updated. Guidance remainsv2.12.0; existing phase-aware
failure/reconciliation rules suffice. Useful fixture reuse exercised; overall
future-change cost reduction remains a hypothesis.

**Next bounded action:** freeze two **overlapping successful moves of the same
own chat** into different shared targets. Hold the first genuine successful PATCH
response after commit A; issue the second native move and establish commit B with
its200 acknowledgment; then deliver A's older acknowledgment. Independently observe
the actual final stored association, full move-only state and direct selected
edit/regenerate context/opaque recall/personality/immutable snapshot, plus navigation
and single-move healthy controls. Both accepted writes retain their actual outcomes;
do not invent latest-start-wins, CAS, stale-write rejection or merged histories.
Freeze the commit/response order and intended consumer coherence before repairs.
Broader list schedules, stronger active-feed/non-author lifecycle policy, unavailable
reconciliation and production Node20/Alpine remain separate.
