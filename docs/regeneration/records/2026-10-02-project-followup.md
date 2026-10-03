# Shared project edit/adoption/reconnect follow-up — 2026-10-02

Current checkpoint **`chat-project-followup-20261002-b`**, final gate v1.2.

Mode **translate**, playbook v2.7.0. Start checkpoint c and dirty trees preserved;
revisions app `bd6c1e0`, Chat `40fe797`, skills `1156ade`. No historical c/b/D/K
replay without changed relevant inputs or a new claim. Start page SHA-256
`397f10a607ae75de72e599aa176bd97a135fe0bbd2cc3383d2705fb37605f3e0`.

## Frozen gate v1 (before runtime changes)

`scripts/chat-project-followup-{journey,checks}.ts` reuse the existing isolated
Next/SQLite/synthetic-user runtime and external Chromium adapter. Chat page owns
adoption/rendering/at-send memory; SQLite remains atomic full-snapshot LWW. No
CAS, schema, migration, dependency, API/event changes. Allowed runtime repair is
the existing page/relay boundary, only after an evidenced positive-gate failure.

Independent expected values are synthetic opaque blobs and exact ordered
message IDs/content. Required positive gates:

- Same-exchange remote adoption updates current memory/content while the local
  at-send snapshot remains immutable for regenerate. A held newer authoritative
  GET cannot rebase the explicit local fork or supersede its rendering. An older
  turn's held late memory cannot persist after regenerate supersedes it.
- After a foreign appended exchange, regenerate/foreign edit are hidden. Editing
  an earlier own question truncates at its local prefix and resets recall to `{}`.
- Two genuine adoption responses overlap; newer requested read wins even when
  delivered first. Feedback consumes exactly adopted messages+opaque memory,
  without a fresh GET masking stale refs. Loaded last-question edit uses adopted
  stored memory as its documented best-available fallback.
- Actual EventSource open precedes remote controls. Actual offline transport
  produces an error and the same feed reopens. Missed idle same-ID changes and
  remote live completion are adopted on reconnect; no ghost/duplicate live turn.
  Feedback carries the adopted coherent snapshot to acknowledged HTTP + SQLite.
- Adoption is read-only; all PATCHes acknowledged, all contexts error/crash-free,
  every selected gate executes once, all genuine held responses are released.
- Independent controls: real two-user login, dark EN/DE, ordinary idle adoption,
  original done-visible before held memory, legacy regenerate ordering, earlier
  edit completion, genuine pre-drop live relay. HTTP independently demonstrates
  allowed local-fork LWW, same-ID opaque replacement and reconnect+explicit read.

No passing HTTP driver claim substitutes for browser recovery. Run all positive
gates on unchanged c bytes and retain failures/healthy controls before repairs.
The runtime's manifest records frozen gate and candidate identities at both ends.
Benefit hypothesis: the existing fixture makes this lifecycle change locally
evaluable without new state machinery or rediscovery of auth/dependencies.

## Environment / ownership

Initial root free ~16GiB, available RAM ~2.4GiB; `/tmp` full and swap full.
One Next runtime at a time; two independent contexts share one owned Chromium.
Owned root-backed scratch INCLUDING profiles:
`/var/tmp/cortex-qa-tmp/project-followup-20261002/`. Retain failed directories;
remove successful scratch only after real evidence retention. External existing
Playwright-core1.63.0/Chromium153 revision1243 (paths in browser adapter), no install.
No commits/deployments/publication, live stores, paid calls, shared Podman changes
or unknown-owner cleanup. Node/browser tripwires are not OS-socket confinement;
Next dev Node22 is not production Node20/Alpine evidence.

Replay from Chat with the owned TMPDIR above:
`node --import tsx scripts/chat-project-followup-journey.ts ../cortex-app/output/<fresh-output> <fresh-id> http|browser`.
Type gate: `node node_modules/typescript/bin/tsc --noEmit -p scripts/tsconfig.chat-project-followup.json`.
Executed results/diagnoses/final identities follow below.

### Evaluator precondition repair (product bytes still unchanged)

Browser baseline a retained at app output `chat-project-followup-browser-baseline-20261002/`,
scratch `chat-journey-WqKhcv`: 18/20 rows, incomplete selection, target crash at
the offline prerequisite. All executed fork/edit/read-order controls passed.
This is inconclusive reconnect behavior, not a product rejection. A minimal
loopback SSE diagnostic shows Playwright `setOffline(true)` does not necessarily
interrupt an existing SSE socket (no error within five seconds). Thus it cannot
establish the required missed-event schedule. The first diagnostic lacked an HTML
content type and timed out before opening; corrected diagnostic reached feed open.
Chromium background diagnostics logged a deprecated registration endpoint; browser
route hooks do not establish native/OS egress confinement or successful external
traffic. No live store/model access occurred.

Replace only the evaluator transport mechanism: `chat-feed-transport.ts` forwards
genuine raw Next SSE through an owned loopback server. It destroys its actual
sockets, returns 503 while held down, and resumes forwarding after restoration;
missed frames are never buffered/fabricated. Require observed native EventSource
error and subsequent open on the same object. Product URL, positive value gates,
healthy controls and baseline page bytes unchanged. New adapter freeze before
baseline b; retained a is not retrospectively credited with reconnect checks.

Baseline b: complete29 rows,24 pass, no page/errors/crashes; retained scratch
`chat-journey-WJIdqu`. Live reconnect prerequisite passes but the positive settled
view and feedback consumer gates reject: the missed `turn_done` leaves a ghost
streaming answer and feedback cannot persist it. Idle reopen precondition is
unmet; stale idle values are not yet evidence of app recovery failure after a
successful reconnect. An initial hypothesis blamed a possible503 terminal reply,
but retained transport rows contain no503: that explanation is unsupported.

Adapter correction v1.1: hold new feed requests while the barrier is down, rather
than allowing a503 terminal response if a retry arrives during the outage. Destroy existing
sockets on drop; on restore forward parked requests to real Next, then require
the same object actually reopens. This isolates a recoverable transport outage.
Positive product gates unchanged, baseline c page bytes still unchanged. Baseline
b's failed value gates and precondition limitation remain retrievable.

Baselines c/d also retained (`chat-journey-iWzOnZ`, `chat-journey-xzPcJL`):
same29/24; live reopen succeeds, idle reopen remains unmet. Added raw before/after
diagnostic shows idle native state stays CONNECTING although upstream status200
is captured. The forwarding adapter must explicitly flush response headers before
an otherwise idle comment-only stream; a minimal held loopback diagnostic
(`output/chat-project-followup-20261002/diagnose-feed.mts`, `feed-diagnostic.json`)
passes real error/reopen with that correction. Diagnostic TS/ESM launch errors
were corrected before it executed; they are machinery failures, not product data.

Accepted broken baseline **e**, gate v1.1: complete29 rows,25 pass; both actual
disconnect/reopen gates, all edit/regenerate/overlapping-read controls and all
error/selection/acknowledgment gates pass. Four positive value gates reject:
missed idle content/recall and missed live completion/feedback. Scratch
`chat-journey-1OLMGx`; exact retained source is unchanged c page. No relaxed gates.

## Evidenced repair

Only `src/app/page.tsx`: adopt on actual EventSource open (initial/reconnect),
guarded by the existing view/request/local-stream ownership. On transport error,
remove only the selected ephemeral remote pair and clear its relay-view identity;
a missed completion cannot strand `liveAssistantId`, and reconnect replay starts
from a clean remote live view. Ref changes are outside pure React updaters;
adoption never writes. At-send snapshots, explicit local forks and server LWW
remain unchanged. No relay/server/schema/migration/dependency changes needed.

Candidate a:28/29, runtime unchanged thereafter; original four value gates now
reach correct adopted content/memory/settled live view. Idle feedback comparator
looked up literal `"answer"` although its selector was a substring, and returned
before its metadata write necessarily committed. This is an evaluator defect,
not a new product bug. Retain scratch `chat-journey-7PLsjG` and original receipts.
Gate v1.2 fixes only supported selector identity and observation readiness: resolve
the independently expected selected message ID; wait for exact `feedback=down`
with exact memory in HTTP/SQLite before the unchanged full-state assertions.
Retained baseline e still rejects the strengthened conjunction at its existing
wrong-memory assertion; new timing/metadata observations are not retroactively
claimed. Final candidate must collect them. No further runtime changes.

Final follow-up browser b v1.2:29/29; separate HTTP a:6/6. Integrated established
project HTTP/browser a:8/8,23/23; integrated ask HTTP a:59+six callbacks pass.
All identify the same page. Established broader browser a crashed on opening its
concurrent fresh-page observer (13/20, incomplete selection, held response retained).
Scratch `chat-journey-kA1Fy5`; inconclusive environment execution, not product
rejection. Root now ~7GiB free, RAM ~3.4GiB available, swap/tmp full. Keep all
diagnostic scratch and unknown-owner processes. Lower only owned Chromium pressure
with retrievable launcher `output/chat-project-followup-20261002/bounded-chromium.sh`:
same existing binary, renderer-process-limit1 and per-renderer JS old-space256MiB.
No product/evaluator-source changes or relaxed assertions; new integrated browser ID
records this explicit executable override. The crash cause is not proven by the
budget adaptation alone; kernel OOM evidence is unavailable.

## Final acceptance / integrated closeout

Only runtime delta since c is the 15-line page feed repair. Final page SHA-256:
`7fa07a7aff5f8270212f1f837cba0ef2ee2175e665155623fc27dc99670f729d`.
Relay `adaa438faf1e7ea592163e7f397fdf4234d3443e4dcc0c1e9618507a5ade58bb` and ask
route `ba4352bc6127a0b66348a0b2b06a849bea6eb7e8df5b03a2abd6ecf9c8372985`
unchanged since c. All other consumed source/public/config/schema/migration/
manifest/lock/dependency inputs match c. No App/backend/SDK/MCP runtime changes.

| Gate | Final result |
|---|---|
| `node --import tsx scripts/chat-project-followup-journey.ts <fresh-output> <fresh-id> http` |6/6, explicit fork LWW, opaque replacement and driver reconnect/read PASS; browser not-run |
| same invocation ending `browser` |29/29 actual Chromium, v1.2; original edit/regen/read-order controls plus native idle/live-missed-completion recovery and adopted-feedback HTTP/SQLite PASS |
| `node --import tsx scripts/chat-project-journey.ts <fresh-output> <fresh-id> http` | integrated8/8 PASS |
| same invocation ending `browser` | integrated23/23 v1.1 PASS |
| `node --import tsx scripts/chat-journey-checks.ts <fresh-output> <fresh-id>` | integrated HTTP59 plus six positive extracted callbacks PASS; browser not-run |
| `node --import tsx scripts/chat-browser-journey.ts <fresh-output> <fresh-id> --mode candidate` | integrated33/33 actual Chromium, owned bounded launcher override, all-context errors/selection/cleanup PASS |
| `npm test` (Chat) |132/132, failed/skipped/cancelled0 |
| `npm run typecheck` (Chat) | PASS |
| `node node_modules/typescript/bin/tsc --noEmit -p scripts/tsconfig.chat-{project-followup,project,browser,journey}.json` (four separate commands) | all PASS on final bytes |
| `npm run validate`; `npm test` (app `documentation/`) | offline names/shapes PASS;10/10 hermetic controls, failed/skipped/cancelled0 |
| `git diff --check` (each of three repos) | PASS |

All journey invocations are from Chat with
`TMPDIR=/var/tmp/cortex-qa-tmp/project-followup-20261002`. Only final established
turn-browser adds
`CHAT_BROWSER_CHROMIUM=/home/clippy/coding/cortex-app/output/chat-project-followup-20261002/bounded-chromium.sh`.
Same underlying Chromium153.0.8010.12/revision1243 binary SHA-256
`8c599d43aec53f2460a31ae2f4af6bd863f8258b34ff519564bc5d4726bfaa1e`, launcher
SHA-256 `5741ed7593c7e491878004079aba3e649574cfcbb23ec6829074e51a419ef299`.
Playwright-core1.63.0 remains external and read-only. Follow-up/project browsers
used the binary directly; final broader browser used renderer limit1/JS256MiB.
Six Next16.1.7/React19.2.4/better-sqlite3-12.9.0 development-runtime manifests on
Node22.22.3 agree, with no installed-graph drift. Production Node20/Alpine, clean
build/install, provider/model quality and OS/native-socket confinement unestablished.

`node output/chat-project-followup-20261002/run-local-checks.mjs` from app owns
retrievable suite/type/doc stdout, exit statuses and before/after input digests in
`local-checks.json` (no behavioral journey replay). Final authoritative journey
writers are the TS wrappers after runtime retention; digests below address those
actual augmented final receipts, with separate co-retained `claim-verdicts.json`.

### Retrievable evidence (app-relative local artifacts)

Each directory under `output/` retains results/verdicts, input manifests, raw
upstream/tripwire/app logs. Browser directories retain selected input page,
PATCH/request bodies, acknowledgments, genuine held-response/feed observations,
tooling and screenshots. Local ignored artifacts are readable on this host;
no off-host backup claim. Baseline e evaluator bytes were recovered by reversing
only the recorded v1.2 delta and **each file matched its actual executed v1.1
digest** before retention in `output/chat-project-followup-20261002/baseline-evaluator-v1.1/`.
`retain-baseline-gate.mjs` owns that byte-retention recipe; it is not product
reconstruction or a new baseline execution. Earlier unsuccessful attempts retain
their original results/manifests/page bytes; no strengthened retrospective verdict.

| Receipt | Directory under `output/` | Final results SHA-256 |
|---|---|---|
| Follow-up browser b | `chat-project-followup-browser-20261002/chat-journey-chat-project-followup-browser-20261002-b-2026-10-02T12-33-59-420Z/` | `ed55d9a5a21fd4e3b785b1c523d136deb5f87d01ec907e4aca7a67d0b108c578` |
| Follow-up HTTP a | `chat-project-followup-http-20261002/chat-journey-chat-project-followup-http-20261002-a-2026-10-02T12-34-36-416Z/` | `13433640f0480e7884075b7a353b7583d03875bfccfb0a0409615c39a0f5e888` |
| Integrated project HTTP a | `chat-followup-integrated-project-http-20261002/chat-journey-chat-followup-integrated-project-http-20261002-a-2026-10-02T12-34-57-109Z/` | `ead6b9982b3f7c3066d60e326a7b9164d20b4928236d8a3068bec3f53ec2a6fe` |
| Integrated project browser a | `chat-followup-integrated-project-browser-20261002/chat-journey-chat-followup-integrated-project-browser-20261002-a-2026-10-02T12-35-42-955Z/` | `4d33f86a2b64af7b6c8db7ae6ecdeee9a4db863f35229d71ba6622beb18a9dfc` |
| Integrated ask HTTP a | `chat-followup-integrated-http-20261002/chat-journey-chat-followup-integrated-http-20261002-a-2026-10-02T12-36-15-929Z/` | `cd9c7d63922f26b3ff3006ea27cfe35c328a43eb915d9d249b1abba700c0c349` |
| Integrated turn browser b | `chat-followup-integrated-browser-20261002/chat-journey-chat-followup-integrated-browser-20261002-b-2026-10-02T12-39-57-528Z/` | `bae6a1dae643078c2217bf104088fbe714de823bb459d810a7ca3745788f3480` |

Broken baseline e:
`output/chat-project-followup-browser-baseline-20261002/chat-journey-chat-project-followup-browser-baseline-20261002-e-2026-10-02T12-31-02-615Z/`.
Earlier a/b/c/d directories share its parent with their exact IDs/timestamps;
candidate a shares final browser's parent; failed integrated browser a shares
final integrated browser's parent. All retained, including diagnostic scratch.

`node output/chat-project-followup-20261002/verify-receipts.mjs` from app is
**read-only evidence/input rejudgment**, not a journey replay. Its retrievable
`integrated-verification.json` validates six executions, exact required selections,
current consumed inputs, one source identity, successful cleanup,109 final/baseline
raw-file digests and local checks. It independently hash-checks c's87 retained raw
files plus c's preserved b/D/original-broken-page receipts. No c/b/D/K replay;
K's historical raw-artifact limitations remain, with no new retrieval claim.

### Knowledge harvest / next action

Updated Chat streaming/state guides, all three campaign indexes, app QA/handoff
and public feature/handbook prose. Canonical policies/playbook v2.7.0 retained.
Final packet read back from disk; no fresh-agent autoload claim. Self-review
(not independent-agent review) checked pure updater effects, view/read/stream
ownership, immutable snapshot semantics, coherent committed feedback and absence
of server/schema/dependency changes. Existing fixture supported this follow-up;
reduced total maintenance cost remains unmeasured.

All successful scratch removed after actual receipt retention. Owned base retains
only failed `chat-journey-{WqKhcv,WJIdqu,iWzOnZ,xzPcJL,1OLMGx,7PLsjG,kA1Fy5}`
plus own caches. Earlier c/b/D scratch and all shared/unknown-owner resources
untouched. Closeout root free ~7GiB; `/tmp` and swap remain full. Recheck RAM/disk
before any new runtime and carry root-backed TMPDIR into browser profiles.

Precise next action: freeze and exercise **reconnect while the teammate is still
streaming**, including repeated drops and actual late-join token replay without
duplicate ephemeral pairs; then remote writes during own done-visible/held-memory
window. Use this fixture's owned genuine transport barriers, independent healthy
controls, actual Chromium and non-repairing feedback/regenerate consumers. No CAS,
schemas/migrations/dependencies, live stores or paid providers. Production parity
requires a separately identified owned Node20/Alpine environment. Do not repeat
completed runs without changed relevant inputs or a new evidence claim.
