# Still-live reconnect / local late-memory continuity — 2026-10-02

Current checkpoint **`chat-project-continuity-20261002-a`**, final gate v1.

Mode **translate**, playbook v2.7.0. Start at `chat-project-followup-20261002-b`;
app `bd6c1e0`, Chat `40fe797`, skills `1156ade`, accepted dirty trees preserved.
Start page SHA-256 `7fa07a7aff5f8270212f1f837cba0ef2ee2175e665155623fc27dc99670f729d`.
Previous109 evidence-file digests checked read-only; before-edit sources/evaluators
and three-repo dirty diffs retained in app `output/chat-project-continuity-20261002/`.
No prior behavioral replay. Existing fixture helpers are exported for reuse;
their original gate assertions stay intact. No new persistence or dependency layer.

## Frozen gate v1 / allowed repair

Owners: page local view/request/turn memory, existing Chat relay, SQLite full-snapshot
LWW. Preserve opaque memory, immutable at-send snapshot, done-visible completion,
explicit edit/regenerate forks and supported SSE orders. No CAS, API/event schema,
DB schema/migrations/dependencies, deployments/commits/publication, live stores or
paid calls. Product repair only after an actual positive-gate rejection.

Independent expectations come from fixed synthetic content, ordered message IDs
and opaque blobs. `chat-project-continuity-{checks,journey}.ts` freezes:

- Two actual native feed drops/reopens while the same teammate ask remains held.
  Tokens received by the actual asker while the observer is disconnected are
  replayed once, in order, with one ephemeral question/answer pair; no new ask.
- A genuine acknowledged settled-prefix revision during the second outage must
  be adopted alongside live replay. Settling later may replace that prefix with
  the asker's immutable full snapshot under unchanged LWW (no merge guarantee).
- Own local `done` is visible while origin memory stays held. Another member
  replaces the same exchange or appends a new one; actual view and feedback adopt
  exactly that remote coherent state before releasing local compaction.
- The valid origin callback remains eligible and writes exactly its own history
  plus late memory. It may win durable LWW. The visible consumer may retain the
  coherent adopted snapshot or show the coherent origin snapshot; it must never
  write remote history with origin memory. Feedback exercises displayed refs
  directly, without a re-fetch that could hide the bug.
- Same-exchange regenerate still replays the immutable pre-turn snapshot and
  truncated prefix after remote adoption and old compaction.
- Adoption/replay is read-only; every browser PATCH acknowledged, all created
  contexts crash/error-free, all selected gates execute once, held responses drain.
- Independent healthy controls: real two-user logins/dark EN+DE, initial live
  replay, both native reconnect prerequisites, legacy live completion, origin late
  callback retention, exact adopted-feedback pre-release and regenerate snapshot.
  Separate HTTP replay/asker/LWW checks do not establish browser orchestration.

Run directly on unchanged start page before repair; retain baseline failures and
full gate bytes. After a changed runtime, re-evaluate affected established gates
under fresh IDs. Historical follow-up/c/b/D/K receipts and scratch remain intact.
Benefit hypothesis: reuse of established transport/SQLite/browser fixtures makes
these state-ownership interactions evaluable without new protocol machinery.

## Environment / replay

Initial root ~7GiB free, RAM ~3.6GiB available; `/tmp`/swap full. Owned scratch and
profiles `/var/tmp/cortex-qa-tmp/project-continuity-20261002/`, one runtime at a time.
Use the existing owned bounded Chromium launcher from previous receipt (same
Chromium153/revision1243, renderer limit1/JS256MiB), external Playwright-core1.63.0;
no installs. Preserve diagnostic scratch and unknown-owner/shared Podman resources.
Transparent loopback feed forwarding drops actual sockets, holds new requests and
flushes genuine headers; actual GET/SSE state is never fabricated.

From Chat, with that TMPDIR and
`CHAT_BROWSER_CHROMIUM=/home/clippy/coding/cortex-app/output/chat-project-followup-20261002/bounded-chromium.sh`:
`node --import tsx scripts/chat-project-continuity-journey.ts ../cortex-app/output/<fresh-output> <fresh-id> http|browser`.
Type gate: `node node_modules/typescript/bin/tsc --noEmit -p scripts/tsconfig.chat-project-continuity.json`.
Real Next dev Node22 is not production Node20/Alpine or model/OS-egress evidence.
Executed baseline/repair/final results and next action follow after execution.

## Executed baseline / repair

Browser baseline a: complete25 rows,22 pass; no errors/crashes, complete selection,
all acknowledgments and both native reconnect prerequisites pass. Exactly three
positive gates reject: missing fresh settled prefix alongside live replay, and
remote-history/origin-memory feedback hybrids after append/same-exchange adoption.
Origin late-write, adopted-feedback before release and immutable regenerate
controls pass. Retained scratch `chat-journey-zYmpCR`; app receipt
`output/chat-project-continuity-browser-baseline-20261002/chat-journey-chat-project-continuity-browser-baseline-20261002-a-2026-10-02T12-59-44-002Z/`
contains full page/gate snapshots and raw events/PATCH/acknowledgment observations.

Evidenced page-only repair: maintain the remote live pair as an ephemeral snapshot,
compose fresh settled adoption with its latest tokens instead of discarding reads
while remote live, and replace only the previous selected relay pair on a new
start/replay. Error/done clears that overlay. All ref/relay mutations happen outside
pure React updaters. A valid local late-memory selection now updates history and
immutable at-send ref together with memory; its origin persistence remains eligible
and wins under unchanged server LWW. The frozen gate permits coherent adopted or
originating views; this candidate selects the coherent originating view.

The source-extracted callback adapter now binds the existing memoryAtSendRef and
setMessages and mirrors the actual LocalTurn.memoryAtSend field at construction;
no oracle/assertion or scheduling criterion changed. Actual Chromium judges the
framework/remote-adoption cases, independently of that synchronous adapter.

## Final combined acceptance

Continuity candidate a passed the **same frozen25/25 Chromium gates**, with both
coherent originating views selected after their eligible late writes. Separate
HTTP a passed7/7 (two genuine reconnect replays, one actual asker request and
acknowledged origin/remote/origin full-snapshot LWW). No evaluator failures or
browser crashes in this slice; the only failed run is the intended product baseline.

| Gate (from Chat except docs) | Final result |
|---|---|
| `node --import tsx scripts/chat-project-continuity-journey.ts <fresh-output> <fresh-id> http` |7/7 PASS; browser not-run |
| same command ending `browser` |25/25 actual Chromium PASS; separate HTTP gate not implied |
| `chat-project-followup-journey.ts <fresh-output> <fresh-id> http` / `browser` with the same loader | integrated6/6 and29/29 PASS |
| `chat-project-journey.ts <fresh-output> <fresh-id> http` / `browser` with the same loader | integrated8/8 and23/23 PASS |
| `node --import tsx scripts/chat-journey-checks.ts <fresh-output> <fresh-id>` | integrated HTTP59 plus six positive callback gates PASS |
| `node --import tsx scripts/chat-browser-journey.ts <fresh-output> <fresh-id> --mode candidate` | integrated33/33 actual Chromium PASS |
| `npm test`; `npm run typecheck` |132/132, failed/skipped/cancelled0; repo typecheck PASS |
| `node node_modules/typescript/bin/tsc --noEmit -p scripts/tsconfig.chat-{project-continuity,project-followup,project,browser,journey}.json` (five separate commands) | all PASS |
| app `documentation/`: `npm run validate`; `npm test` | offline names/shapes PASS;10/10 hermetic controls, failed/skipped/cancelled0 |
| `git diff --check` in each repo | PASS |

All commands carry `TMPDIR=/var/tmp/cortex-qa-tmp/project-continuity-20261002`;
all browser runs also use the previously recorded bounded launcher override.
Eight successful real Next16.1.7/React19.2.4/better-sqlite3-12.9.0 dev runtimes on
Node22.22.3 share one source manifest; installed dependencies/locks/native smoke,
required selections, all-context errors, no tripwire attempts, receipt retention
and successful scratch removal accepted. Changed page and callback bindings justify
these fresh integrated IDs; no old follow-up/c/b/D/K behavioral IDs were replayed.
Production Node20/Alpine, clean build/install, provider quality and native/OS egress
confinement remain unestablished; no deployment, publication or commit performed.

Only runtime delta since follow-up is `src/app/page.tsx`, SHA-256
`174b1329e1e399569eb7e89950a2c528569c4d5004c67dfced26b98b578fd22d`.
Relay `adaa438faf1e7ea592163e7f397fdf4234d3443e4dcc0c1e9618507a5ade58bb` and ask
route `ba4352bc6127a0b66348a0b2b06a849bea6eb7e8df5b03a2abd6ecf9c8372985`
remain unchanged, as do all other consumed runtime/public/config/schema/migration/
manifest/lock inputs. Evaluation-only changes: new continuity scenario/runner/type
config, fixture helper exports and source-extracted callback bindings. No App/
SDK/MCP runtime changes or new execution claim for those components.

## Retrievable evidence / final writer

Below are **app-relative local ignored artifacts**, readable on this host, with no
off-host backup claim. Each directory retains final `results.json` and separate
`claim-verdicts.json`, source/input manifests and raw app/upstream/tripwire evidence;
browser directories additionally retain page, requests/PATCH bodies, feed/ack/
consumer observations and screenshots. Every continuity invocation retains the
complete executed gate bytes in `gate-snapshot/`. The TS wrappers are authoritative
final writers after runtime cleanup; digests below address their augmented final bytes.

| Receipt | Directory under app `output/` | Final results SHA-256 |
|---|---|---|
| Continuity browser a | `chat-project-continuity-browser-20261002/chat-journey-chat-project-continuity-browser-20261002-a-2026-10-02T13-03-42-773Z/` | `b67729a0f148c3d3588dcfde90bf38fc7538081d2b6f006f58277c4132225d0b` |
| Continuity HTTP a | `chat-project-continuity-http-20261002/chat-journey-chat-project-continuity-http-20261002-a-2026-10-02T13-04-18-741Z/` | `4278407adbba1d626026dbb34582b2c4c18775bb2fd6b2b764774ffc0f9601c7` |
| Integrated ask HTTP a | `chat-continuity-integrated-http-20261002/chat-journey-chat-continuity-integrated-http-20261002-a-2026-10-02T13-04-40-732Z/` | `e88e93776f694c37e09e92684de05c282479cb7d655e321d1bb4e31218d49c6f` |
| Integrated follow-up browser a | `chat-continuity-integrated-followup-browser-20261002/chat-journey-chat-continuity-integrated-followup-browser-20261002-a-2026-10-02T13-05-41-948Z/` | `bbb106a1320566f9753b5fd3bbdf66420ecd96c85194ff9556db2d5c9143aeb4` |
| Integrated follow-up HTTP a | `chat-continuity-integrated-followup-http-20261002/chat-journey-chat-continuity-integrated-followup-http-20261002-a-2026-10-02T13-06-03-350Z/` | `a2f45a188775f2d27bfa16f4b059585a580db83d5b79f4d556d7ee80bf1984b0` |
| Integrated project browser a | `chat-continuity-integrated-project-browser-20261002/chat-journey-chat-continuity-integrated-project-browser-20261002-a-2026-10-02T13-06-48-017Z/` | `985c2e9f7855bccc7f2289642ed2685e669c5cf41b6812188a0a9ed993f952ff` |
| Integrated project HTTP a | `chat-continuity-integrated-project-http-20261002/chat-journey-chat-continuity-integrated-project-http-20261002-a-2026-10-02T13-07-09-599Z/` | `8c0d62fae6629d1604ac0d03b45d1705fa80f5a1cdedddd5cefd847ef88577fe` |
| Integrated turn browser a | `chat-continuity-integrated-browser-20261002/chat-journey-chat-continuity-integrated-browser-20261002-a-2026-10-02T13-08-40-895Z/` | `c80074227435a3981d3c43c76f4d76a945fa76ebb8f2c9baeec2523e144cd600` |

From app, `node output/chat-project-continuity-20261002/verify-receipts.mjs` is a
**read-only input/receipt rejudgment**, not a journey replay. Its retained
`integrated-verification.json` validates eight executions/current inputs/required
selections,144 final+baseline evidence-file digests, full frozen baseline gates,
the original three intended rejections and successful cleanup. It also verifies
the previous109 evidence-file digests, c's87 raw files and retained b/D/original
broken-page receipts. K's historical raw-evidence limitations stay unchanged.
`start-inputs/`, `start-inputs.json`, three `*-start.diff` files and
`previous-NEXT_SESSION.md` preserve the prior dirty state/handed packet.
`run-local-checks.mjs` retains actual suite/type/doc stdout, exit status and
before/after/current input hashes in `local-checks.json`.

## Harvest / resource handoff / next action

Updated owning streaming guide, QA, all three checkpoint indexes, public project/
memory prose and QA continuation packet; canonical root policies/playbook v2.7.0
retained. Final packet read back on disk; no fresh-harness autoload/reconstruction
claim. Self-review (not independent-agent review) checked overlay versus local
turn ownership, immutable snapshots, pure updaters and coherent callback/write
pairs. Fixture reuse is demonstrated; total maintenance-cost savings unmeasured.

All successful scratch removed after actual receipt retention. Only this slice's
failed `chat-journey-zYmpCR` and own caches remain under
`/var/tmp/cortex-qa-tmp/project-continuity-20261002/`; previous follow-up/c/b/D
diagnostic scratch remains untouched. Shared Podman/unknown-owner resources
untouched. Closeout root ~4.8GiB free, RAM ~3GiB available; `/tmp` and swap full.
Recheck capacity before another runtime; keep all browser profiles root-backed.

Precise next action: freeze and hold **genuine adoption GETs across relay
replacement and arriving tokens**, then terminal local navigation away/back while
origin compaction remains held. Verify selected overlay/history/recall and immutable
at-send memory through feedback/regenerate consumers; preserve coherent origin
LWW and independent healthy controls. No CAS/schema/migration/dependencies or
live/paid-provider effects. Do not replay completed runs without changed relevant
inputs or a new claim. Production parity needs a separately identified owned
Node20/Alpine environment.

## Portable harvest after execution

Playbook **v2.8.0** generalizes this session and the preceding follow-up: genuine
transport-fault preconditions, readiness versus catch-up, live overlay/base
composition, coherent history/opaque recall/at-send selection under LWW,
auxiliary-write commit observation, adapter field fidelity and executed gate-byte
retention. Product-neutral rules live in the portable playbook; concrete fixtures,
counts, ownership and next action remain in this record and the owning guides.
Current version pointers/QA prompt updated. This is documentation-only: no runtime
or evaluator input changes, no behavioral replay, no amended historical verdicts.
The executed v2.7.0 basis above remains historical fact.
