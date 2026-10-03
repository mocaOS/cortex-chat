# Own-chat project move / acknowledgment ownership — 2026-10-02

Checkpoint **`chat-project-move-20261002-d`**, verified local patch/evaluation slice.
Translate / playbook **v2.10.0**, resumes **`chat-project-sharing-20261002-b`**.
App `bd6c1e0`, Chat `40fe797`, skills `1156ade`; existing dirty work preserved.
**Move HTTP8/8 + actual Chromium23/23 v1.3 PASS**; fresh18-run integrated candidate
listed below. Runtime delta only `src/app/page.tsx` and `src/lib/chatHistory.ts`.
Exact before/after bytes and hashes are in App `output/chat-project-move-20261002/`.

## Intent and boundary

An organizational move changes only `chat_sessions.project_id`. Preserve every other
session column, message ID/order/content/metadata/citation sid/authorship, opaque
memory, personality and recency timestamps. Target membership is checked at write;
only a chat's creator moves it. Shared destinations require actual consent, cancel
does not write, and private destinations/moving out remain silent. Existing chats
do not inherit the target's creation defaults. Late compaction remains eligible for
its origin under unchanged atomic full-snapshot LWW; moving does not invalidate the
local immutable at-send snapshot used by edit/regenerate.

Storage success and view ownership differ: a failed move must not select the target
context; a valid pending origin move may commit while the user navigates, but its
acknowledgment cannot rebind the newly selected chat. No CAS/schema/migration/
dependency/protocol change. SDK/MCP/App runtime untouched; no commit/deployment/
publication/live-store/paid calls. Open-feed connect-time admission remains as
documented in the sharing slice; move-out fresh404 is not instant active-feed revoke.

## Frozen gate and preserved attempts

New `scripts/chat-project-move-{checks,journey}.ts`, type config
`scripts/tsconfig.chat-project-move.json`; existing isolated SQLite/Next/held-loopback
SSE/Chromium fixture. Two real synthetic user logins and independent contexts share
one owned browser. Actual native HTML5 `dragTo` executes the product data-transfer
handler; native `confirm` is accepted/dismissed with the exact existing wording.

- Healthy controls: dark EN/DE, cancel/no PATCH, full raw SQLite move-only equality,
  owner/member sidebars and fresh HTTP/feed admission, foreign chat not draggable,
  member move404, inaccessible target400, move-out/private destination no consent.
- Local done-visible origin with compaction held moves into shared target; its late
  exact blob/history remains durable. Direct regenerate retains original at-send
  memory/prefix/personality and selected target; after move-out feedback consumes
  exact current recall. Private move then direct edit-last retains that same snapshot.
- Revoke target grant through the other synthetic owner's HTTP request while the
  real consent dialog blocks the page, then accept:400 must preserve origin rows
  and a direct no-refetch redo must keep personal context.
- Hold a genuine successful move PATCH response after its transaction, select a
  different personal chat via sidebar, then release: origin move remains durable,
  while a direct redo of the new selected chat must keep its own context/recall.
- Every attempted PATCH has an acknowledgment: only the independently expected
  revoked-target400 is allowed. Complete selection, all-page errors/crashes,
  unhandled rejection, application tripwires, response drain, input/cleanup gates
  remain required. Two animation frames observe committed view state after an
  acknowledgment; that is a driver schedule, not a product/replacement requirement.

Attempts remain immutable and retrievable:

| Attempt | Verdict / diagnosis |
|---|---|
| HTTP a v1 |8/7, exit1: actual id/role/content projection compared with metadata-rich unprojected expected fixture; all raw move-only gates passed |
| HTTP b v1.1 |8/8 PASS on unchanged runtime; expected projection corrected, full raw metadata oracle retained |
| Chromium a v1.1 |10/9, exit1/partial selection: generic held wait accepts released predecessor; new browser request paired with old upstream record, release fails; not a product-value rejection |
| Chromium b v1.2 |23/20, exit1: two real context value failures; also14 acks/13 PATCH captures because exact-route holder bypasses generic passive recorder |
| Chromium c v1.3 |23/21, exit1: exactly both intended context assertions reject; all healthy/ack/error/selection/drain controls pass |
| Focused move-client baseline |1/2, exit1: authoritative404 incorrectly resolves; `AssertionError: Missing expected rejection`, imports/healthy200 succeeded |
| Candidate HTTP c / Chromium d v1.3 |8/8 and23/23 PASS, both exit0; same frozen positive values/gate |

`GATE-CORRECTION.md` owns separate v1→v1.1 projection, v1.1→v1.2 active operation/
request-ID wait and v1.2→v1.3 actual intercepted PATCH capture corrections. Full frozen
bytes are retained for each version, plus per-run `gate-snapshot/`. v1.3 runs against
the unchanged page before implementation and still rejects both product defects.
No gate relaxation, shared-helper change, runtime repair due to machinery failure,
or deletion of failed rows. Diagnostics retain the raw mismatched request IDs/acks.

## Smallest candidate

- `page.tsx`: propagate move failure into early return/list refresh; after success
  use live `activeSessionRef.current`, not captured `activeSessionId`, for context
  rebinding. Remove the obsolete callback dependency. Origin storage effects still
  complete and refresh lists; current view/recall is not borrowed across navigation.
- `chatHistory.ts`: `setChatProject` treats the generic read helper's null404 as
  rejection.200 still resolves void;400 already rejected; demo-local dispatch and
  generic read404 semantics remain. `tests/chat-project-move-client.test.ts` froze
  this success/rejection contract before repair and passes2/2 on the candidate.
- `tests/chat-project-move-oracle.test.ts`: healthy in/out comparison plus five
  injected recency/personality/opaque-memory/metadata/authorship losses rejected at
  the comparator's `AssertionError`. These are self-controls; Chromium c is the real
  product-defect sensitivity evidence.

Baseline page hash remains
`d69771cbc47f0cd598b6172ae67d1b3a1b4206cb5394af5c0dd13ab20a2a40ca`.
`candidate-inputs.json` verifies exactly two changed runtime files, retains their
bytes/digests and all unchanged source identities. No other source/schema/locks changed.

## Integrated verification and retrieval

All actual invocations/exit observations/log hashes are in `*-command.json`. From
Chat with owned TMPDIR and recorded Chromium launcher:
`node --import tsx scripts/chat-project-move-journey.ts <fresh-output> <fresh-id> http|browser`.
Types: `node node_modules/typescript/bin/tsc --noEmit -p scripts/tsconfig.chat-project-move.json`.

Because runtime inputs changed, established gates ran under **fresh integrated IDs**:

| Surface | Final HTTP / actual Chromium |
|---|---|
| Move v1.3 |8 /23 |
| Sharing v1.1 |11 /25 |
| Shutdown v1 |7 /31 |
| Terminal v1.4 |6 /47 |
| Selection v1 |6 /29 |
| Continuity v1 |7 /25 |
| Follow-up v1.2 |6 /29 |
| Project lifecycle v1.1 |8 /23 |
| Ask/turn |59 HTTP + six positive extracted callbacks /33 |

Every row passes with exit0, no required skip, clean input/cleanup/error gates. Source
manifest agreement across18 executions belongs to `integrated-verification.json`;
the prior c/b/continuity/follow-up/selection/terminal/sharing/shutdown/D/K receipts
remain historical, not overwritten/reused as current runtime acceptance.

Local gates: **suite142/142, fail/skip/cancel0; repo/move types PASS; App docs
validator and10/10 controls PASS; three-repo whitespace PASS**. Command/log/receipt
digests are in `local-checks.json` and the final closeout.

App-relative entry **`output/chat-project-move-20261002/`**:

- `start-inputs.json`, dirty diffs/status/revisions, `before-knowledge/`,
  `baseline-page.tsx` / `baseline-chatHistory.ts`, four frozen gate directories,
  frozen client test, candidate snapshots and input identities.
- `http-a-diagnosis.json`, `browser-{a,b,c}-diagnosis.json`, raw failed and final
  wrapper `results.json`/`claim-verdicts.json`, screenshots, native dialogs, raw
  source/GET/ask/PATCH/ack/held response observations. Failed receipts keep their
  failed obligations and actual nonzero outcomes.
- `move-http-c/`, `move-browser-d/`, and `integrated-<family>-<surface>/` retain all18
  accepted receipts. `verified-inputs/` additionally retains actual evaluator bytes
  after equality to each executed manifest (post-execution byte retention, not replay).
- Local `npm test`, repo/move types, docs validator/control results live in
  `local-checks.json`; final counts/digests/whitespace are in the integrated closeout.
- `node output/chat-project-move-20261002/verify-evidence.mjs` from App is a one-shot
  read-only current-input/receipt audit, writes only the new aggregate, refuses
  overwrite. It checks all prior145/134/133/190/225/144/109/87 evidence sets, preserved
  failed attempts, every selected stage and final source/evaluator identities.

Owned scratch/profile base `/var/tmp/cortex-qa-tmp/project-move-20261002/` keeps failed
`chat-journey-{QPm6oT,DDamSr,tVeYCM,B2P5SZ}` with source/SQLite/log/profile/private
dependencies/.next. Successful scratches removed only after receipt retention.
Root~85GiB free, RAM~12GiB available, swap free; unchanged2GiB floor retained. All
earlier failed diagnostics/archives/shared/unknown-owner resources untouched.

Actual Node22.22.3/Next16.1.7/React19.2.4/better-sqlite3-12.9.0 dev; external
Playwright-core1.63.0/Chromium153 revision1243, no installs. Same owned renderer2/
JS512MiB launcher `output/chat-project-terminal-20261002/diagnostic-chromium.sh`,
stderr retained. App tripwires do not prove OS/background-browser egress confinement.
Production Node20/Alpine/model quality, overlapping moves of the same chat and
instantaneous active-feed revocation remain outside this schedule.

## Harvest and next action

Owning streaming/storage/QA guides, three-repo checkpoints, public feature source
and handbook updated; unreleased patch explicitly labeled, no changelog/publication.
Portable playbook remainsv2.10.0; existing acknowledgment/operation ownership rules
apply. Fixture reuse exercised useful follow-up change; total change-cost saving is
still a hypothesis. No replacement/reconstruction or production parity claim.

Next bounded action: freeze **actual project deletion/explicit chat detach** through
native confirm cancel/accept. Verify only owner management, all authors' surviving
flat lists/complete rows/history/metadata/opaque memory/personality, fresh former-member
admission, valid held origin compaction, and acknowledgment after navigation. Compare
current view selection separately from origin storage; preserve older-schema detach
controls without changing schema/migrations. Use direct consumers before repairs.

## Portable harvest after execution — 2026-10-03

Playbook **v2.11.0** generalizes shutdown, sharing and move lessons at their existing
owners: §7.3 distinguishes fresh admission/context scope/ongoing authority; §7.6
preserves mutation rejection through read-style sentinels; §9.1/9.2 cover symmetric
projections, action/no-op proof and actor-bound repair reads; §9.4/9.5 identify retry
reset, active attempts and interceptor/observer composition; §12.3 distinguishes
post-execution byte retention and a separate documentation harvest; §13.3 preserves
organizational state and delayed mutation ownership; §14.3 requires complete relevant-
path proof before reusing a stage. §21 adds concise symptoms/corrections.

Current pointers/continuation usev2.11.0; **d's executed v2.10.0 basis above**, source/
gate bytes, original aggregate, all18 actual results and historical failures remain
unchanged. This is a documentation-only harvest, with no new journey, reconstruction,
instruction-autoload or production claim. App-relative before snapshots, integrity/
current-input/whitespace audit: `output/chat-project-move-20261002/verify-playbook-harvest.mjs`,
`playbook-harvest-before.json` / `playbook-harvest-before/` and
`playbook-harvest-verification.json`. The original execution closeout stays immutable.
