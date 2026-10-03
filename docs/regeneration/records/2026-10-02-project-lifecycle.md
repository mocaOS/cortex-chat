# Shared project-chat lifecycle — 2026-10-02

Mode **translate**. Current checkpoint **`chat-project-lifecycle-20261002-c`**.
Final project **HTTP8/8; actual Chromium23/23**, gate v1.1. Gate packet **v1**, frozen before runtime
changes. Revisions: app `bd6c1e035b3e6ece7741a0b733bfd8735145f846`, Chat
`40fe79799c4729c4b695890566ef3a51746b3b5e`, skills
`1156aded6726d6105cb13a72ded93efaf55f5bef`; accepted dirty trees preserved.
Start page is b's `7e70390e52d521a3a3802cdd065c27f0b72d25a46537db49a7121b674ab24e2d`.

## Frozen intent, boundary and oracle

The next project change should reuse the real Next/SQLite/browser fixture rather
than rediscover authentication, storage and SSE setup. Chat owns page-local views
and turns, the in-process relay and SQLite. App/SDK/MCP REST/SSE semantics remain
unchanged. No CAS, revision fields, schema, migration or dependency changes.

Independent expected values come from synthetic questions, exact ordered message
IDs/content/authorship and opaque blobs. Accepted obligations:

- **HTTP:** members can replace messages/memory, outsiders cannot; administration
  stays author-only. Concurrent acknowledged full snapshots leave exactly one
  coherent pair (either writer is permitted); sequential last acknowledgment wins.
- **Relay:** genuinely overlapping held streams both complete for their askers;
  finishing the older stream must not remove the newer live registry. A late join
  replays the latest stream's own question/content, without another stream's tokens.
- **Browser adoption:** an idle member sees acknowledged remote changes, including
  content/feedback changes retaining the same IDs/count. Adoption is read-only.
- **Rebase:** normal project send uses the fresh server history and opaque memory;
  edit/regenerate remain deliberate local forks using the at-send snapshot.
- **Async ownership:** a held adoption read released after navigating away must
  not replace the destination's messages/memory. Leaving and returning to one's
  own streaming project turn restores its current rendering/loading, then settles
  normally; foreign sessions receive no originating persistence effects.
- **Overlap:** two members' actual UI streams overlap. Each settled PATCH succeeds;
  the selected last full snapshot wins coherently. Other clients converge to it,
  without writing adopted state back or inventing a merged-turn guarantee.
- Healthy controls include ordinary idle adoption, both SSE orders, visible done
  before held memory, reload/verbatim replay, project rebase, dark EN/DE and real
  form logins. Required errors, selection, input drift, retention and cleanup fail
  closed across every created browser context.

Run positive gates directly on the unchanged baseline, retain raw failures and
full source identity, then repair only evidenced failures. Gate rejection is
reported separately from execution and healthy controls. K/D/b are not replayed.
After relevant runtime changes, b's gates may be reused under fresh IDs to judge
the new combined candidate; historical receipts remain intact.

## Environment and authority

Initial capacity: `/tmp` full, root about 22 GiB free, about 2.6 GiB available RAM,
swap full. One runtime at a time; browser profiles use owned root-backed TMPDIR.
Reuse external Playwright-core1.63.0/Chromium1243 from b's receipt, no installs.
No commits/deployments/publication, live stores, paid models, shared Podman or
unknown-owner cleanup. Runtime copies existing dependencies privately. Loopback
fixtures and browser/Node tripwires are not OS/native-socket confinement.

Results, final identities, integrated verification and next action are appended
after execution; this specification alone is not acceptance evidence.

## Baseline attempts (retained)

- HTTP baseline a: 7/8 rows, positive newer-live-replay gate failed; members,
  outsiders, authorship, concurrent/sequential LWW and both askers complete controls
  passed. Source `page.tsx` still b. Scratch `chat-journey-Bi7EaV` under this slice's
  owned `/var/tmp/cortex-qa-tmp/project-lifecycle-20261002/`.
- Browser baseline a: Chromium target crashed during the first adoption control;
  7/10 rows, incomplete required selection. **Inconclusive UI behavior**, not a
  healthy-control/product defect. Scratch `chat-journey-IXef9s` retained. Root
  recheck ~20 GiB free, available RAM ~2.7 GiB; kernel logs unavailable (permission).
  Evaluation adapter now shares one Chromium process across independent user
  contexts and explicitly collects page crashes into required page-error gate.
  Positive value/selection gates unchanged; product baseline not edited yet.
- Browser baseline b (one Chromium, no crash): complete22 rows,14 pass; late
  adoption replaced personal destination and replayed origin memory, producing
  an attempted cross-chat PATCH500; returning own held stream lost visible/loading
  state even though its origin persisted and the member converged. Healthy idle
  adoption timed out before same-ID case; revised case then passed because it
  advanced the still-old count. Thus **same-ID sensitivity unestablished in b**.
  The adapter now waits for the actual EventSource `open` before remote writes,
  retains raw feed frames and requires the adopted prefix before same-ID testing.
  This is precondition/observation strengthening, not an acceptance relaxation;
  all positive gates remain unchanged, baseline product bytes unchanged.
- Browser baseline c: complete22 rows,14 pass, no runtime/browser errors or
  input drift. Idle adoption now passes; same-ID gate rejects at its intended
  assertion. Navigation/recall, returning own live turn and acknowledgment gates
  fail with retained raw PATCH500. Overlap starts, coherent last-writer durable
  pair, convergence and legacy/reload/replay controls pass. Scratch
  `chat-journey-pAuJEv` retained. This is the accepted UI broken baseline.

## Evidenced repair

Runtime patch confined to `page.tsx`, `chat-events.ts` and ask relay orchestration.
Adoption captures view and request ordering, rejects stale results after navigation
or local streaming, and applies full state outside React updaters (IDs/count are
not a content/memory oracle). Returning local live turns reattaches their view,
immutable at-send memory and abort control. The relay registry returns an in-memory
turn identity; only that selected turn can append/end/publish. Overlapping askers
still receive their own full streams and persist via unchanged server LWW.
No schema, migration, dependency, event-shape or SDK/MCP change.

Review found v1's same-ID gate asserted content but not the selected feedback
glyph or adopted recall: ordinary project send's fresh rebase could mask a stale
ref. **Gate v1.1** strengthens that existing requirement with the actual selected
thumb and a user feedback write carrying the exact adopted blob through HTTP +
SQLite. No gate is removed/relaxed. The retained c baseline still rejects the
stronger content+feedback conjunction at the existing content assertion; newly
added feedback/recall observations are not retrospectively claimed for c. Runtime
candidate is unchanged for this supplemental evaluation. Original candidate a
receipts remain v1; final v1.1 results are recorded below.

Candidate browser b:21/23 rows, unchanged runtime; supplemental selectors used
"Good/Bad response" but supported English labels are "Good/Bad answer"
(`src/lib/i18n.ts`). Two locator timeouts are **evaluation defects/inconclusive
for supplemental metadata/feedback**, not reproduced product bugs. All original
v1 gates still passed. Retained scratch `chat-journey-NkeLdM`; corrected selectors
only, exact glyph/blob requirements unchanged. Root recheck ~16 GiB free.

## Final acceptance and integrated verification

The same isolated Next16.1.7/React19.2.4/better-sqlite3-12.9.0 development runtime
on Node22.22.3 is exercised by all four successful final journeys. External
Playwright-core1.63.0 + Chromium153.0.8010.12/revision1243 (paths in b's receipt),
one Chromium process/two independent project-user contexts; browser profiles under
`TMPDIR=/var/tmp/cortex-qa-tmp/project-lifecycle-20261002`. No installs. Production
Node20/Alpine, external model/service quality, OS/native-socket confinement,
multi-replica relay and untested UI lifecycle are not established.

| Gate (from Chat unless stated) | Executed result |
|---|---|
| `node --import tsx scripts/chat-project-journey.ts <fresh-output> <fresh-id> http` | v1.1 HTTP8/8; coherent acknowledged LWW, access/attribution and overlapping relay late-join ownership PASS; browser not-run |
| same command ending `browser` | v1.1 actual Chromium23/23; all frozen project controls/races plus exact same-ID feedback/recall PASS; separate HTTP gate not implied |
| `node --import tsx scripts/chat-journey-checks.ts <fresh-output> <fresh-id>` | integrated HTTP59 + six positive extracted callbacks PASS; browser not-run |
| `node --import tsx scripts/chat-browser-journey.ts <fresh-output> <fresh-id> --mode candidate` | integrated Chromium33/33: rapid send, regenerate, edit-last, chat switch; settled/legacy/reload/dark EN/DE PASS |
| `npm test` |132/132, zero failed/skipped/cancelled; three new real registry contracts |
| `npm run typecheck` | PASS |
| `node node_modules/typescript/bin/tsc --noEmit -p scripts/tsconfig.chat-project.json` | PASS (final evaluation bytes) |
| same typecheck with `scripts/tsconfig.chat-browser.json` and `scripts/tsconfig.chat-journey.json` | both PASS |
| app `documentation/`: `npm run validate`, `npm test` | offline names/shapes PASS;10/10 controls PASS |

All commands use the owned TMPDIR above (including docs tests). Integrated
turn-bound gates were justified by the three changed runtime inputs and used new
IDs, **not historical b's ID**. HTTP/browser verdicts are co-retained separately;
passes mean all required rows, selection, execution, error collection, drift,
tripwire, final retention and cleanup passed. Four runtime manifests agree.
Revisions remain the three start revisions; no commits or deployments.

Self-review (not independent-agent review) checked ownership across adoption,
navigation, pending snapshots, abort controls, at-send memory and relay cleanup.
The full-state adoption removes the incorrect ID/count shortcut; no new persistent
coordination layer. Three registry tests also cover same-user overlapping streams,
stale token append, independent chats and healthy single-stream behavior.
Benefit observed: existing auth/fixture/browser machinery supported this follow-up
and uncovered real faults; total maintenance-time reduction remains unmeasured.

## Retrievable evidence and final identity

All three final `git diff --check` checks passed. Owning Chat guides, three-repo
indexes, app QA handoff and public project-concurrency prose updated; no changelog
entry for this hotfix/evaluation slice. Final entry packet was read back on disk.

Paths below are **app-relative**, readable local ignored artifacts, not off-host
backups. Each final directory retains `results.json`, `claim-verdicts.json`, app/
tripwire logs and frozen manifests; project browser baseline/candidate directories
collectively retain full page copies, requests/PATCH bodies, acknowledgment/feed
observations, tooling and screenshots. Final writer is the corresponding TS
wrapper after runtime retention; hashes address those final result bytes.

| Receipt | Directory under app `output/` | Final results SHA-256 |
|---|---|---|
| Project HTTP c | `chat-project-http-20261002/chat-journey-chat-project-http-20261002-c-2026-10-02T11-14-34-532Z/` | `49c696334bef3d4a918ee2cc0ccfb4667e6d99b0cd6a8a36d6679c90d06bf4ef` |
| Project browser c | `chat-project-browser-20261002/chat-journey-chat-project-browser-20261002-c-2026-10-02T11-14-13-811Z/` | `67083a46e0c8b336659016d33cee07885ff0d5a06934d784ae474756e3807320` |
| Integrated HTTP a | `chat-project-integrated-http-20261002/chat-journey-chat-project-integrated-http-20261002-a-2026-10-02T11-07-19-928Z/` | `12a761d6cd3547494a92596ea700f09d3952b116be35f71a6bc052d0aafb30ab` |
| Integrated browser a | `chat-project-integrated-browser-20261002/chat-journey-chat-project-integrated-browser-20261002-a-2026-10-02T11-08-58-909Z/` | `99d42af394c4953a5e7817ef1bc84735eeee4f398988f15bd777d619d780e091` |
| Broken project HTTP a | `chat-project-http-baseline-20261002/chat-journey-chat-project-http-baseline-20261002-a-2026-10-02T10-55-19-511Z/` | `77fc6cdbfb1228787ab863f4c07ff61eb644167de94b07c98586972cb3ab2156` |
| Broken project browser c | `chat-project-browser-baseline-20261002/chat-journey-chat-project-browser-baseline-20261002-c-2026-10-02T11-02-32-184Z/` | `6ca2e9d4ce06209f8ee46cdc2e2b2d48adcfd430b4289fc8c9fb377d43d680c1` |

`node output/chat-project-lifecycle-20261002-c/verify-receipts.mjs` from app is a
**read-only input/evidence rejudgment**, not a behavioral replay. Its retained
`integrated-verification.json` lists all final result/verdict digests and87 raw
evidence file digests, validates required selections/current consumed-input hashes,
matching runtime manifests and absent successful scratch, preserves b/D/original
broken-page digests and project baseline failures. Compared with b, only these
runtime inputs changed (all other source/schema/migrations/manifests/locks match):

- `src/app/page.tsx`: `397f10a607ae75de72e599aa176bd97a135fe0bbd2cc3383d2705fb37605f3e0`
- `src/lib/chat-events.ts`: `adaa438faf1e7ea592163e7f397fdf4234d3443e4dcc0c1e9618507a5ade58bb`
- `src/app/api/ask/stream/route.ts`: `ba4352bc6127a0b66348a0b2b06a849bea6eb7e8df5b03a2abd6ecf9c8372985`

No new App/backend/SDK/MCP execution claim; those runtime inputs are unchanged.
No reconstruction, replacement, clean install/build, release or production claim.

## Resource handoff and next slice

Successful project c and integrated a scratch removed **after receipts retained**.
Root recheck ~16 GiB free, available RAM ~3.2 GiB; `/tmp` full and swap full.
Only this slice's owned base `/var/tmp/cortex-qa-tmp/project-lifecycle-20261002/`
contains retained failures `{chat-journey-Bi7EaV,chat-journey-IXef9s,
chat-journey-XwTJg7,chat-journey-pAuJEv,chat-journey-NkeLdM}` plus own tsx/Node
compile caches. Preserve before any exact-owner cleanup; no cleanup by prefix.
Earlier b/D diagnostic scratch ownership lists remain in their original records.
Shared Podman and unknown-owner resources untouched. K/D not executed; historical
b receipts unchanged and directly hash-verified. K raw-artifact limitations remain
as previously recorded; no new raw retrieval claim for K.

Next local slice: **shared-project edit/regenerate after remote adoption,
overlapping adoption reads and disconnect/reconnect**. Freeze immutable pre-turn
snapshot, explicit local-fork and coherent LWW expectations with independent
controls; exercise real UI plus acknowledged HTTP/SQLite before fixing defects.
Production Node20/Alpine needs a separately identified owned environment. Do not
repeat c/b/D/K without changed relevant inputs or a new evidence claim.

## Portable playbook harvest

The subsequent **v2.7.0** documentation harvest generalizes this slice's lessons:
stable identity is not freshness; adoption is read-only and view/request-bound;
relay operation identity differs from durable LWW; real feed/read-barrier
preconditions and non-repairing consumers are needed for meaningful oracles;
browser process pressure, target crashes, bad selectors and strengthened-gate
evidence need distinct treatment. Current campaign/playbook pointers and QA handoff
updated. This harvest changes no runtime/evaluation input or historical receipt,
and establishes no new journey execution or stronger retrospective c verdict.
