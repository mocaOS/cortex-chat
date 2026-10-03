# Project sharing grant / revoke — 2026-10-02

Checkpoint **`chat-project-sharing-20261002-b`**, verified evaluation/knowledge slice.
Translate / playbook **v2.10.0**, resumes **`chat-ask-shutdown-20261002-a`**.
App `bd6c1e0`, Chat `40fe797`, skills `1156ade`; dirty work preserved.
**HTTP11/11 v1 + actual Chromium25/25 v1.1 PASS**, unchanged runtime. Page still
`d69771cbc47f0cd598b6172ae67d1b3a1b4206cb5394af5c0dd13ab20a2a40ca`.

## Contract extracted before freeze

Owners: SQLite `projects` / `project_shares`; `projects.ts` membership predicates;
owner-only shares/settings/delete routes; collaborative chat messages+memory PATCH;
`ProjectShareModal.tsx`, `Sidebar.tsx`, page list/feed orchestration. Effects are
atomic grant replacement and notifications; no chat snapshot mutation by sharing.

- Owner implicitly belongs. Direct user or group grant admits a member (OR);
  removing the individual grant alone retains group admission. PUT deduplicates,
  filters unknown principals and skips explicit owner user grants. Invalid mixed
  principals reject400 without replacing the valid set; non-owner management404.
- Directory: min2 characters, small groups/people results, owner omitted. Member
  sees project/chat listing without the owner's share list or management controls.
- Current list/chat read/save and **new** chat-feed admission recheck membership.
  Revoke of the final covering grant rejects404 for a non-author member. A chat's
  author retains their own chat rights independently of project membership.
- General ask remains permitted by the caller's group key. Inaccessible project
  IDs omit private project context instead of making all ask requests403. Local IDs
  are stripped upstream. Source guards relay admission independently via chat access.
- User feed channel membership is snapshotted at connect; page refreshes/reopens
  on project-set changes. Open chat feed checks admission at connect and does **not**
  revalidate/terminate on share removal. HTTP observed an old admitted feed receive
  a later owner change event after revoke; new feed404 and fresh UI reload reject.
  This is an observed limitation, not an accepted instant-revocation implementation
  or a requirement that future implementations retain old-feed access. Sidebar
  disappearance alone does not establish active-subscription revocation.

## Frozen positive gates / actual orchestration

New `scripts/chat-project-sharing-{checks,journey}.ts`, type config
`scripts/tsconfig.chat-project-sharing.json`, exact grant oracle
`tests/chat-project-sharing-oracle.test.ts`. Existing runtime/consumers reused:
synthetic SQLite, real migrations/crypto, private existing dependencies, real Next
dev, held loopback SSE; actual two-user form logins/independent contexts in one Chromium.

HTTP11 rows cover directory/private admission, direct-grant normalization, owner-only
management, attributed member full-snapshot continuation, direct+group union,
revoke/read/save/new-feed/private-context exclusion, regain and complete error/selection/
response drain. An explicit same-memory owner write produces the old-feed observation;
its bookkeeping timestamp is a separate intended effect, not a share-write allowance.

Chromium25 rows cover dark EN/DE and actual modal search (one-character query does
not dispatch), selected direct user chip/save, exact owner HTTP/SQLite grant set,
live member sidebar appearance without reload, hidden owner controls, no repairing
GET feedback, member continuation with held compaction, preserved prefix/opaque
memory and server-stamped authorship, owner adoption/feedback, dual grants, individual
removal with group still admitted, final revoke, live sidebar removal, fresh404 reads/
saves/feeds, actual revoked-chat reload clearing URL/history, group regrant/sidebar,
fresh changed-rating feedback and healthy owner exact history/recall. Share-only
operations compare **all raw chat columns and message metadata bytes**, not counts.
Every captured PUT/PATCH must be acknowledged200; all-page errors/crashes, blocked
application requests, unhandled rejection, selection, drain, input/cleanup controls
fail closed. No CAS/schema/migration/dependency or LWW/immutable-snapshot changes.

## Failed attempt / independent gate correction

Browser **a v1:25 selected/24 pass, exit1**, retained. Only owner feedback's global
no-GET count rejects13 vs12. Raw landmarks: last owner GET19:17:32.331, feedback
PATCH19:17:32.471, owner PATCH200 and peer **member GET**19:17:32.534. Peer adoption
is a legitimate consequence of the write; no owner repairing read occurred.

Self-review also finds a false-positive v1 regained consumer: its Bad answer target
already has `feedback: down`; `MessageBubble.tsx` intentionally does not dispatch
an already-selected rating. a's four PATCHes contain no regained write. Preserve
the historical green row, but it cannot support that new-operation claim.

Separately frozen **v1.1** counts only the consumer actor's chat reads. Its local
feedback adapter changes regained rating down→up, requires a **new** matching PATCH,
200 acknowledgment and selected metadata in HTTP/raw SQLite with unchanged ordered
history/opaque memory. Initial member/owner feedback uses the same stronger adapter.
Values, grants, required selection, budgets/error/drain gates and runtime remain.
No shared-helper edit or product fix; `GATE-CORRECTION.md` and26 hashed a receipt
files/landmarks in `attempt-a-diagnosis.json` own this machinery diagnosis.

Browser **b25/25 v1.1, exit0**. HTTP a11/11 v1 was not replayed: its complete checks
prefix before `runSharingBrowser` (HTTP runner, constants and all used helpers) is
byte-identical. The runner's only difference is emitted gate-version metadata.
Closeout checks both comparisons, full executed gate snapshots, common runtime,
config/schema/locks and every unchanged helper; HTTP retains its executed v1 basis.

Two comparator tests (healthy empty/direct/group/union; five faulty missing/spurious/
duplicate/mixed/empty-principal observations rejected at `AssertionError`) are
self-controls, not Chromium fault injection. Imports are outside rejection checks.

## Verification, resources and retrievable evidence

From Chat with owned root-backed TMPDIR and recorded external Chromium launcher:
`node --import tsx scripts/chat-project-sharing-journey.ts <fresh-output> <fresh-id> http|browser`.
Typecheck: `node node_modules/typescript/bin/tsc --noEmit -p scripts/tsconfig.chat-project-sharing.json`.
Local required suite/types/docs commands and exits are in `local-checks.json`:
**`npm test`138/138, fail/skip/cancel0; repo + sharing types PASS; App docs validator
and10/10 controls PASS; three-repo whitespace PASS**. Final integrated counts/
identities are in the closeout below. No commit/deploy/
publication/live-store/paid calls. SDK/MCP sources and contracts unchanged.

App-relative entry **`output/chat-project-sharing-20261002/`**:

- `start-inputs.json`: dirty-tree status/diffs/revisions, before-knowledge snapshots,
  capacity and tools, read-only previous shutdown134/terminal133+190/selection225/
  continuity144/follow-up109/project87 evidence-file checks and10 old runtime manifests.
- `frozen-gate-v1/` and `frozen-gate-v1.1/` + manifests: actual before-run bytes.
  Each receipt also retains `gate-snapshot/`; a's freeze/receipt remains unchanged.
- `http-a-command.json` / `browser-{a,b}-command.json`: actual commands/exits/log
  digests and final wrapper receipts under `http-a/` / `browser-{a,b}/`.
- Raw screenshots/chips/sidebars, source page/share modal/sidebar, directory queries,
  actor-tagged GETs/PUTs/PATCHes/acks, native feed observations and upstream requests.
  `browser/sharing-observations.json` retains exact operation/metadata evidence.
- `GATE-CORRECTION.md`, `attempt-a-diagnosis.json`, retained failed scratch,
  public-doc before snapshots, final local check logs and Chromium stderr.
- `integrated-verification.json`: HTTP a + Chromium b acceptance, required selections,
  source/gate/candidate/receipt hashes, explicit HTTP relevant-input reuse, all prior
  preservation checks, knowledge/resources and evidence-file digests. New audit only:
  `node output/chat-project-sharing-20261002/campaign.mjs verify` from App. It refuses
  to overwrite its final report; historical reports are never executed/rewritten.

Owned scratch/profile base `/var/tmp/cortex-qa-tmp/project-sharing-20261002/`.
Root~90GiB free, RAM~12GiB available, swap free; unchanged2GiB floor retained.
Successful HTTP a and browser b scratch removed after receipt retention. **Failed
`chat-journey-bPx2L7` remains with source/SQLite/log/profile/private dependencies/.next**.
All earlier diagnostics/archives/shared/unknown-owner resources untouched.

Actual Node22.22.3/Next16.1.7/React19.2.4/better-sqlite3-12.9.0 dev context;
Playwright-core1.63.0/Chromium153 revision1243, no installs. Recorded owned launcher
App `output/chat-project-terminal-20261002/diagnostic-chromium.sh`, renderer2/JS512MiB,
stderr root-backed. Clean app tripwires do not prove process-background/OS egress
confinement. Production Node20/Alpine, live backend/model quality, instantaneous
open-feed revocation and broader browser journeys remain outside the claim.

## Harvest / next action

Owning streaming/integration/storage guides, all three indexes, App QA/handoff,
public feature docs and handbook now explain grant union/fresh admission and the
connect-time feed limitation. Public source updates remain unpublished; no changelog
or runtime release claim. Portable playbook staysv2.10.0; its existing actor/effect/
specific-commit rules already cover this lesson. Fixture reuse exercised; total
future-change cost reduction remains a hypothesis.

Next bounded action: **actual Chromium own-chat move into/out of a shared project**.
Freeze cancel/confirm of the existing shared-history consent dialog, owner-only
administration, current membership of the target, live owner/member sidebar and
fresh read/feed admission; verify unchanged complete history/metadata/opaque memory/
personality and organizational timestamp, then direct selected recall/edit/regenerate
consumers. Use real drag/drop and non-repairing acknowledged observations before any
fix. Project delete/explicit detach follows. If immediate active-feed revocation is
required, specify that separate authorization/lifecycle delta first; current fresh-
admission evidence does not establish it. Preserve b/a and all prior receipts.
