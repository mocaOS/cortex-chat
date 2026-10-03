# Held adoption / terminal navigation — 2026-10-02

Current checkpoint **`chat-project-selection-20261002-a`**, gate v1.
Mode **translate**, playbook v2.8.0; resumes `chat-project-continuity-20261002-a`.
App `bd6c1e0`, Chat `40fe797`, skills `1156ade`, existing dirty trees preserved.
Read-only start capture verifies the prior144 evidence-file digests and unchanged
runtime inputs. Sources/evaluators, three-repo diffs/status and previous handoff:
app `output/chat-project-selection-20261002/start-inputs.json` and `start-inputs/`.

## Frozen positive gate v1 / before runtime edits

`scripts/chat-project-selection-{checks,journey}.ts` extends the existing real
Next/isolated SQLite/held loopback SSE/actual Chromium fixture. Fixed synthetic
message identities and opaque blobs are the oracle. Required cases:

- Genuine adoption GET captured from the running server while the first relay is
  live, delivered after a replacement relay and its tokens arrive. Fresh settled
  base plus exactly one latest live pair must remain; old pair must disappear.
- Another genuine adoption GET held across more selected tokens; exact ordered
  accumulated content survives delivery. Older relay completion cannot retire
  the selected relay. Read-only adoption and settled-feedback recall controls.
- Own `done` visible with compaction held, remote same-exchange adoption, actual
  sidebar navigation away/browser-back. Feedback consumes the selected coherent
  history/recall directly. Regenerate must retain immutable local at-send memory,
  including when compaction lands while away. Replaced callbacks stay superseded;
  eligible origin writes still complete under full-snapshot LWW.
- Independent controls: real two-user login/dark EN+DE, live progress, genuine
  held response bytes, origin durability, done-visible, return view/stop state,
  exact HTTP+SQLite feedback metadata/recall, fork completion, all PATCH200s,
  all-context errors/crashes, complete selection and response drain.
- Separate HTTP gate characterizes selected relay replay after overlap/older
  completion and acknowledged full-snapshot LWW. It does not establish UI behavior.

Only a positive product assertion rejection authorizes the smallest Chat-local
repair. No CAS/schema/migration/dependency changes. Opaque memory, immutable
snapshots, both SSE orders, valid origin writes and server LWW are preserved.
No commits/deployment/publication/live stores/paid calls. Existing historical
baselines/diagnostics and shared/unknown-owner resources remain owned elsewhere.

Initial capacity: root5.7GiB free/RAM2.8GiB available; `/tmp` and swap full.
Owned scratch/profiles: `/var/tmp/cortex-qa-tmp/project-selection-20261002/`.
Existing external Playwright-core1.63.0/Chromium153 revision1243 and retained
`output/chat-project-followup-20261002/bounded-chromium.sh` launcher (renderer1,
JS256MiB); one runtime/browser process at a time, no installs.

From Chat, with that TMPDIR and `CHAT_BROWSER_CHROMIUM` launcher override:
`node --import tsx scripts/chat-project-selection-journey.ts ../cortex-app/output/<fresh-output> <fresh-id> http|browser`.
Typecheck: `node node_modules/typescript/bin/tsc --noEmit -p scripts/tsconfig.chat-project-selection.json`.
Each run retains full executed gate bytes. Production Node20/Alpine and model/OS
egress claims remain unestablished. Freeze/execute baseline before any page edit.

## Baseline / diagnosis / candidate

Unchanged continuity page baseline a completed29 checks,27 pass. Exactly
`browser.held.regenerate-at-send` and `browser.away.regenerate-at-send` reject:
actual memory is respectively `held-remote` and `away-late`, expected immutable
`held-at-send` / `away-at-send`. All held-GET/relay/token gates, healthy return,
feedback coherence, fork/origin durability, acknowledgment/error/selection gates
pass. This is product sensitivity, not a tool/crash failure. Baseline receipt:
app `output/chat-project-selection-browser-baseline-20261002/chat-journey-chat-project-selection-browser-baseline-20261002-a-2026-10-02T15-47-07-891Z/`.
Retained diagnostic scratch: `chat-journey-wBaOJe` under this slice's owned base.

`loadSession` used stored recall as edit/regenerate fallback for every terminal
turn, despite retaining its local immutable snapshot. Smallest page-only repair:
on load, preserve a nonsuperseded local turn's `memoryAtSend` when the loaded last
message identity matches; different exchange retains stored fallback. Current
history/recall remains the actual loaded coherent snapshot. Valid origin writes,
supersession, relay and full-snapshot LWW are untouched. Same frozen gate v1
judges the candidate; no assertion/adapter changes after this baseline.

Integrated attempt a: selection HTTP6/6 and continuity HTTP7/7 pass, then continuity
Chromium target crashes at native reconnect (`feedState`/reopen polling); only8
rows selected,4 pass. This is a failed execution, not an intended value assertion
rejection. All-context error/unhandled/selection/drain gates fail closed. Receipt
and `chat-journey-1GYQ3Y` scratch retained; root3.6GiB/RAM2.9GiB available afterward.
Kernel journal inaccessible/no entries; crash mechanism remains unknown. Explicit
environment adaptation: same binary, renderer1, JS heap512MiB plus stderr logging
via owned `output/chat-project-selection-20261002/diagnostic-chromium.sh`. Changed
launcher justifies fresh attempt b for the failed browser gate; no product/gate
bytes change. A later pass cannot prove exhaustion caused attempt a.

Continuity browser b passes25/25. Follow-up HTTP a passes6/6; follow-up browser a
completes29 rows/28 pass, rejecting only live native reopen's20s prerequisite.
No page crashes/errors; late missed-state/feedback gates pass. Raw forwarder retry
at15:53:06 receives genuine headers dated15:53:37, final same EventSource is
OPEN with opens2/errors1. Next's actual log reports that event route's30.8s dev
compilation (34.5s total). This is a failed timed execution with an observed dev
compiler stall, not acceptance via eventual state. Preserve receipt and
`chat-journey-CNQmbp`; do not widen timeout or change product. One targeted fresh
unchanged-gate browser b run follows that diagnosis; no replay of passed HTTP.

## Final combined verdict / evidence

Same frozen gate passes selection **HTTP6/6 and actual Chromium29/29**. Only
runtime delta from continuity is `src/app/page.tsx`, SHA-256
`d69771cbc47f0cd598b6172ae67d1b3a1b4206cb5394af5c0dd13ab20a2a40ca`.
Relay/ask route, other consumed runtime/config/schema/migration/manifest/lock
inputs remain unchanged. New evaluation files only: selection checks/runner/type
config. No accepted old evaluator/assertion changes, SDK/MCP or App runtime edits.

| Required gate (from Chat except docs) | Final result |
|---|---|
| `node --import tsx scripts/chat-project-selection-journey.ts <fresh-output> <fresh-id> http` / `browser` |6/6 HTTP,29/29 Chromium PASS; separate verdicts |
| same invocation with `chat-project-continuity-journey.ts` |7/7 HTTP,25/25 Chromium b PASS |
| same invocation with `chat-project-followup-journey.ts` |6/6 HTTP,29/29 Chromium b PASS |
| same invocation with `chat-project-journey.ts` |8/8 HTTP,23/23 Chromium PASS |
| `node --import tsx scripts/chat-journey-checks.ts <fresh-output> <fresh-id>` |59 HTTP + six positive callback gates PASS |
| `node --import tsx scripts/chat-browser-journey.ts <fresh-output> <fresh-id> --mode candidate` |33/33 Chromium PASS |
| `npm test`; `npm run typecheck` |132/132, failed/skipped/cancelled0; repo types PASS |
| `node node_modules/typescript/bin/tsc --noEmit -p scripts/tsconfig.chat-<name>.json` for project-selection/project-continuity/project-followup/project/browser/journey (six commands) |all PASS |
| App `documentation/`: `npm run validate`; `npm test` |offline names/shapes PASS;10/10 hermetic controls, failed/skipped/cancelled0 |
| `git diff --check` in all three repos |PASS |

All runtime/browser scratch is root-backed via the owned TMPDIR above. Selection
baseline/candidate use the retained256MiB launcher; integrated Chromium b and
remaining browser gates use the same binary via the diagnostic512MiB launcher.
Actual Node22.22.3/Next16.1.7/React19.2.4/better-sqlite3-12.9.0 dev runtime, existing
private dependency copies, no installs. Ten accepted executions have one matching
source manifest, exact input hashes, complete/error-free selected gates, all
acknowledgments, no Node/browser-route tripwire attempts and successful scratch
removal. This is not OS-egress confinement: retained Chromium stderr includes
browser-background GCM attempts beyond page routing. No paid provider calls,
live stores, publication/deployment/commit or production parity claim.

App-relative evidence entry **`output/chat-project-selection-20261002/`**:

- `integrated-verification.json` enumerates all10 accepted receipt directories,
  final `results.json`/`claim-verdicts.json` hashes, required selections,225 final/
  failed/baseline evidence-file digests and current runtime/evaluator identities.
  `node output/chat-project-selection-20261002/verify-receipts.mjs` from App
  verifies these read-only; it is not a journey replay. Previous continuity144,
  follow-up109/c87 raw files and retained b/D/original broken baselines checked.
- Selection browser receipt:
  `output/chat-project-selection-browser-20261002/chat-journey-chat-project-selection-browser-20261002-a-2026-10-02T15-48-26-306Z/`,
  final results SHA-256 `2c42277f8bcb1c677f4b899ad1ffc4872e78259730b5c0fd45f6d4894c1ba6c7`.
  Selection HTTP receipt:
  `output/chat-selection-integrated-selection-http-20261002/chat-journey-chat-selection-integrated-selection-http-20261002-a-2026-10-02T15-49-17-097Z/`,
  final results SHA-256 `0ff29ee14b44343e99ee545b9b93d37546703d686e269d23ccdc803aed9fcbd2`.
- Runtime wrappers are the authoritative final receipt writers after cleanup.
  Every selection run retains full `gate-snapshot/`; browser receipts retain
  page bytes, genuine GET bodies, feed/PATCH/ack/consumer observations/screenshots.
  `candidate-inputs/` retains every consumed source/evaluator/test byte; hashes
  verify current inputs and executed helper bytes across all accepted runs.
- `integrated-runs.json`, `remaining-runs.json`, `finish-runs.json` and their logs
  retain actual commands/exits including both halted batch attempts. Separate
  continuity/follow-up browser b invocations above exited0. `local-checks.json`
  and logs retain13 suite/type/doc/diff commands/exits and before/after identities.
- Raw artifacts are local ignored host files, readable here; no off-host backup
  claim. Failed baseline/crash/timeout receipts remain unchanged and retrievable.

## Harvest / resources / precise next action

Owning streaming/storage guides, QA, three-repo indexes, public project-memory
prose (explicitly unreleased) and `qa/NEXT_SESSION.md` updated. Final packet read
back; no new harness-autoload, reconstruction or independent-review claim.
Self-review checks local identity/fallback guard versus loaded history/recall,
supersession and unchanged LWW. Reusing the fixture demonstrates that this useful
follow-up needs no new state/protocol layer; total cost saving remains unmeasured.

All successful scratch removed only after receipt retention. Preserve this base's
`chat-journey-{wBaOJe,1GYQ3Y,CNQmbp}`, Chromium stderr and caches; previous diagnostics
and shared/unknown-owner resources untouched. Root~2.4GiB free/RAM~3.5GiB available,
`/tmp`/swap full; recheck capacity before another runtime and keep profiles root-backed.

Next bounded action: freeze **terminal edit-last after navigation return** and
**different remote-adopted last-exchange fallback on return**, contrasted with a
fresh-page stored-memory fallback while origin compaction stays held. Feedback/
edit/regenerate must consume the exact selected history/recall/immutable snapshot;
valid origin writes retain LWW eligibility. Preserve gates/baselines before repairs.
Broader ask-shutdown UI and project share/move/delete remain later inventory items;
production Node20/Alpine needs a separately identified owned environment. Do not
replay passed gates without changed relevant inputs or a new claim.

## Portable harvest after execution

Playbook **v2.9.0** generalizes the session's lessons at their existing owners:
Section5.4 records changed-budget launcher/diagnostic limits;9.4 adds genuine
held-read replacement/progress interactions;9.6 diagnoses missed readiness bounds
by phase without accepting eventual success;12.2 accounts for process-background
network bypass;12.3/14.3 reconcile selectively resumed stages and actual exits;
13.3 preserves valid immutable retry state across terminal navigation independently
of loaded history/recall and stored fallback. Concrete fixtures/counts/paths remain
here, not in the portable guide. Current version pointers/QA prompt and owning
QA/storage guidance are synchronized. This is documentation-only: the executed
v2.8.0 basis above, product/evaluator inputs and historical receipt bytes/verdicts
remain unchanged. The pre-harvest `integrated-verification.json` remains the
identified execution closeout; new knowledge identities belong to the harvest.
Harvest validation/evidence entry (App-relative):
`output/chat-project-selection-20261002/verify-playbook-harvest.mjs` and
`playbook-harvest-verification.json`. This checks portable/version pointers,
three-repo whitespace, retained225 evidence digests and10 runtime/evaluator
manifests read-only, recording current documentation identities separately.
