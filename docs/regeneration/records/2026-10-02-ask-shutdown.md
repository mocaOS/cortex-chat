# Ask shutdown / resubmit — 2026-10-02

Checkpoint **`chat-ask-shutdown-20261002-a`**, **verified evaluation/knowledge slice**.
Mode **translate**, playbook **v2.10.0**, resumes **`chat-project-terminal-20261002-f`**.
App `bd6c1e0`, Chat `40fe797`, skills `1156ade`; dirty trees preserved.
**HTTP7/7, actual Chromium31/31, suite136/136 PASS**. No runtime repair justified;
runtime remains the accepted selection candidate, page SHA-256
`d69771cbc47f0cd598b6172ae67d1b3a1b4206cb5394af5c0dd13ab20a2a40ca`.

## Intent, boundary and frozen gate

Gap: parser unit tests covered shutdown retries, but did not establish partial
answer reset, actual UI resubmission, exhaustion or durable recall through the
page. Reuse the existing isolated SQLite/Next/held-loopback fixture; freeze positive
assertions before judging the candidate. Preserve opaque state, immutable at-send
snapshots, stable correlation IDs and server atomic full-snapshot LWW.

New gate: `scripts/chat-shutdown-{checks,journey}.ts`,
`scripts/tsconfig.chat-shutdown.json`, **`ask-shutdown-v1`**. Canonical authority:
streaming and backend-integration guides, existing `streaming-contract.test.ts`.
No changes to old gates/helpers, product runtime, schema, migrations, dependencies
or producer/SDK/MCP semantics. No commit/deployment/publication/live-store/paid calls.

- Actual form login and dark EN/DE surfaces; synthetic personal chats with known
  ordered prefix/opaque pre-turn blobs. Personal chats remove project normal-send's
  fresh-rebase masking path. External HTTP/SQLite reads observe storage without
  feeding their result back to the browser.
- Healthy settled control: visible `done` with compaction held, exact pre-memory
  durable snapshot, then late opaque memory. Legacy memory-before-done control too.
- Shutdown success: partial attempt0 genuinely visible; raw `event: shutdown`
  released over the actual upstream socket; attempts1/2 flushed and held with no
  content. Old partial must disappear **before** replacement content arrives.
  Each cleared unfinished attempt leaves durable prefix/recall unchanged and emits
  no PATCH. Genuine token progress is then written to that held socket. A second
  shutdown exercises the full two-resubmit budget; attempt2 visibly finishes with
  compaction held and then persists its exact late blob.
- Exhaustion: three genuinely visible partial attempts, three shutdown frames,
  terminal `Error: Connection lost while the server was restarting`; no fourth
  dispatch during the declared1.5s observation (retry interval1s). Durable state is
  exactly prefix + one question + one error answer, with original opaque recall.
- All resubmits retain identical request bodies and one nonempty `X-Request-ID`
  at both browser and upstream boundaries. Local relay IDs are stripped upstream;
  uncompressed SSE header remains `Accept-Encoding: identity`. Correlation stability
  is not a new idempotency/CAS contract.
- Each case: exact ordered history, unique generated IDs, unchanged prefix, no
  discarded partial in attempted PATCHes/UI/durable answer; exact HTTP and SQLite
  memory bytes. Direct feedback consumes selected recall without a browser chat GET
  and waits for its specific metadata commit. Direct regenerate consumes the
  immutable pre-turn blob/prefix without a repairing GET while held, uses a **new**
  request ID for the new action, settles and survives actual reload.
- Required controls: every PATCH acknowledged200, all-page errors/crashes and
  unhandled rejections absent, complete unique selection, all held responses drained,
  clean application tripwires, input drift/retention/cleanup accepted.

HTTP gate executes the **actual parser** through real Next HTTP, adapting only the
relative ask URL/cookie. Absolute requests retain the original fetch transport.
It checks settled/legacy ordering, two shutdown retries, stable/echoed headers,
restart error/exhaustion and exact driver PATCH/GET/SQLite persistence. Those driver
writes are HTTP evidence; they do not substitute for the separate Chromium page.

Local raw-frame adapter exists because the old shared browser controller JSON-encodes
initial strings. It flushes headers and writes genuine raw SSE; release uses the
unchanged runtime writer. Request IDs are reused sequentially, so each held response
is released/removed before another attempt with that ID is dispatched. Owned response
sequence numbers distinguish observations; neither adapter count nor ID-keyed hold
registry changes the product protocol.

## Executions and comparator controls

Frozen v1 accepts the **unchanged baseline** on first HTTP and browser execution.
There is no product defect reproduction, failed browser attempt or candidate fix.
This fills a consequential coverage gap, not replacement/reconstruction evidence.

`tests/chat-shutdown-oracle.test.ts`: four comparator self-controls (two healthy,
two grouped fault checks) reject eight wrong observations at the oracle's own
`AssertionError`: concatenated partial, lost prefix, SQL/HTTP recall disagreement,
mutated unknown memory, changed retry ID, request drift, wrong immutable recall,
and fourth dispatch. Imports are outside rejection assertions. These are **oracle
self-controls**, not fault injection into Chromium or a reproduced page defect.
The real browser separately supplies partial/clear/late-memory/error observations.

| Invocation from Chat (owned TMPDIR; Chromium launcher below) | Result |
|---|---|
| `node --import tsx scripts/chat-shutdown-journey.ts <fresh-output> chat-ask-shutdown-http-20261002-a http` | **7/7 PASS, exit0** |
| same command, `chat-ask-shutdown-browser-20261002-a browser` | **31/31 Chromium PASS, exit0** |
| `npm test` | initial **132/132**, final **136/136**, fail/skip/cancel0; final includes four new oracle controls |
| `npm run typecheck` | **PASS** |
| `node node_modules/typescript/bin/tsc --noEmit -p scripts/tsconfig.chat-shutdown.json` | **PASS**, frozen/final bytes match |
| App `documentation/`: `npm run validate`; `npm test` | **PASS;10/10 controls**,0 fail/skip/cancel |
| all three repos `git diff --check` | **PASS** |

Final suite after adding the comparator controls does not invalidate already-run
HTTP/Chromium inputs. Established terminal/selection/continuity/follow-up/project/
turn/D/K gates were not replayed: all relevant runtime/evaluator inputs still match.

## Retrievable evidence and environment

App-relative entry **`output/chat-ask-shutdown-20261002/`**:

- `start-inputs.json`: three dirty-tree diffs/status/revisions, before-knowledge
  snapshots, capacity, binary/launcher/input identities; read-only verification of
  terminal f133/d190, selection225, continuity144, follow-up109 and project87 evidence
  files and all10 prior selected runtime manifests. All historical verdicts remain.
- `frozen-gate-v1.json` + `frozen-gate-v1/`: before-run gate bytes/types/identity.
  Every run also retains `gate-snapshot/` and runtime manifests.
- `http-a-command.json` and `browser-a-command.json`: actual process exits/log
  digests and final receipt directories under `http-a/` / `browser-a/`.
- Final wrapper-written `results.json` and `claim-verdicts.json` own execution and
  obligation verdicts after cleanup. Browser receipt includes input page, screenshots
  at each partial/clear phase, request/PATCH bodies, acknowledgments, raw held events
  and `browser/shutdown-observations.json`. Upstream raw requests remain too.
- `local-checks.json` / `final-local-checks.json`, command receipts and logs retain
  the132 and136 suite runs separately. `oracle-controls.test.ts` retains executed
  self-control bytes. No old receipt or test baseline is overwritten.
- `campaign.mjs verify` is a **read-only current-input/receipt audit**, not a
  behavioral replay. It writes the new `integrated-verification.json` with all
  receipt/input/evidence digests, accepted selections, knowledge and resource identities.
  Run from App: `node output/chat-ask-shutdown-20261002/campaign.mjs verify`.

Root-backed owned scratch/profile base:
`/var/tmp/cortex-qa-tmp/ask-shutdown-20261002/`. Initial/final root~90GiB free,
RAM~12GiB available/swap free; runtime2GiB floor retained. Both successful runtime
scratches removed **after** receipts retained. Only this session's small caches and
Chromium stderr remain in that base; stderr is also retained in the evidence entry.
All earlier failed diagnostics/archives and shared/unknown-owner resources untouched.

Actual Node22.22.3/Next16.1.7/React19.2.4/better-sqlite3-12.9.0 development context,
private verbatim existing dependency copies; external Playwright-core1.63.0 and
Chromium153/revision1243. Owned recorded launcher (App-relative)
`output/chat-project-terminal-20261002/diagnostic-chromium.sh`: same binary,
renderer limit2/JS512MiB, stderr under owned TMPDIR. No installs. Browser-background
GCM registration errors remain in stderr; clean app tripwires do not establish
process-wide egress confinement. Production Node20/Alpine, real restart/deployment,
live backend/provider quality, reconnect during late compaction after `done`, and
broader browser journeys are outside this demonstrated schedule.

## Harvest and precise next action

Streaming/integration/storage guides, App QA/campaign packet and all three indexes
now route to this reusable gate. The portable playbook remains v2.10.0: existing
principles already cover this slice. Future-change cost benefit is a hypothesis;
fixture reuse was exercised without introducing a product state/protocol layer.

Next bounded slice: **actual Chromium project sharing grant/revoke** through the
owner's share modal with a second synthetic user. Freeze owner-only management,
directory search and persisted grant set; prove fresh member list/chat reads,
continue-ask and new event-feed admission before/after revocation, exact preserved
history/opaque memory and healthy owner controls. Extract existing open-feed
membership-snapshot semantics before defining its observation gate. Use direct
consumers and acknowledgments before repairs. Move/delete and production parity
follow. Preserve current gates/baselines; replay passed journeys only for changed
relevant inputs or a new claim, under fresh IDs.
