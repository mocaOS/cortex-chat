# Project deletion / explicit detach / acknowledgment — 2026-10-03

Checkpoint **`chat-project-delete-20261003-c`**, translate / playbook **v2.11.0**,
resumes **`chat-project-move-20261002-d`**. App `bd6c1e0`, Chat `40fe797`, skills
`1156ade`; dirty work preserved. Frozen **delete HTTP9/9 and actual Chromium21/21
v1.1 PASS**. Runtime delta only `src/app/page.tsx`'s delete acknowledgment selection.

## Intent, boundary and oracle

Owner-only DELETE `/api/me/projects/[id]` explicitly detaches `chat_sessions.project_id`
inside the same transaction before deleting the project. The project and its shares
disappear; all authors retain their chats in their own flat lists. Every other raw
session field and message byte remains, including personality, pin, opaque recall,
metadata/citation sid, per-message and chat authorship, IDs and timestamps. Unrelated
projects, grants and chats remain exact. Project ownership does not confer ownership
of a former member's detached chat.

Fresh reads/saves/feed admissions recheck author access after removal; general ask
still uses caller-key permission, omitting deleted optional project instructions.
Existing active-feed instantaneous revocation is not claimed. Valid author-origin
compaction remains eligible under unchanged full-snapshot LWW. Local immutable
pre-turn recall remains available to direct edit/regenerate. Successful storage
deletion and permission to alter the currently selected view are distinct effects.

Gate `scripts/chat-project-delete-{checks,journey}.ts`, type config
`scripts/tsconfig.chat-project-delete.json` reuses the established isolated real Next
dev/SQLite/migrations/crypto/held-loopback fixture and existing external Chromium.
Two synthetic logins share one browser with independent contexts. No live data or
provider calls. External HTTP/read-only SQLite observations never repair page state.

- Actual native confirmation: DE cancel, EN cancel and accept, exact existing copy;
  cancel emits no mutation. Owner-only control is both UI absence and real member404.
- Complete raw project/share/session/message comparisons at the deletion boundary;
  fixtures include both chat authors, a mixed-authorship prefix, metadata-rich
  citations, personalities, pins, opaque recall and a separate unaffected project.
- Both actors' live sidebars and fresh flat lists retain only their own detached
  chats. Fresh own reads/feeds pass; cross-author reads/saves/feeds return404 and
  rejected saves preserve all state.
- Own done-visible turn has compaction held across deletion. Late history/blob are
  durably retained; direct changed-rating feedback checks a fresh write and raw
  metadata commit without a consumer chat GET. Direct regenerate and edit-last
  consume the original immutable pre-turn memory/prefix, detached context and
  retained personality; each held redo is correlated by browser/upstream request ID.
- A genuine successful DELETE response is held **after its transaction**. The same
  mounted page selects another project's chat through the sidebar; only then is
  acknowledgment delivered. Direct regenerate must retain that chat's project
  instructions, recall, personality and prefix without a repairing GET.
- All attempted browser DELETE/PATCH requests reconcile with200 acknowledgments;
  every page's errors/crashes, blocked app requests, unhandled rejection, complete
  selection, held-response drain, source drift and cleanup remain required.

Legacy control `tests/sqlite-contracts.test.ts` is retained: a synthetic historical
ALTER without SET NULL rejects bare deletion and accepts explicit detach. This is a
SQLite pattern control, **not** an actual Next handler run against historical schema.
No production schema/migration/dependency, CAS or server concurrency change.

## Baselines, correction and smallest patch

| Attempt | Executed verdict |
|---|---|
| HTTP a, v1, unchanged product |9/9 PASS, exit0 |
| Browser a, v1, unchanged product |7 selected/4 pass, exit1, incomplete: English-only sidebar helper cannot address German Header; failure leaves DE active, causing dependent owner/send/selection failures |
| Browser b, v1.1, unchanged product |21 selected/20 pass, exit1: exactly `browser.held-ack-consumer-context` rejects null instead of the unrelated current project; all healthy, state, direct-consumer, acknowledgment/error/selection/drain controls pass |
| Final HTTP b / browser c, v1.1 |9/9 and21/21 PASS, exit0 |

`GATE-CORRECTION.md` records the separate bilingual delete-local selector change,
locale restoration in finally, and both actors' EN reload before dependent cases.
No values/bounds/old helpers weakened; v1.1 froze and executed on unchanged product
before repair. Both failed attempts, gate versions and scratch remain retrievable.

Small patch: replace captured `activeProjectId` comparison after await with pure
`setActiveProjectId(current => current === project.id ? null : current)`; retire
the obsolete callback dependency. It neither reads/repairs history nor introduces
a new ref/state owner. Rejection/transport-failure scheduling remains a separate
unverified case; existing `.catch` handling was not changed under this success gate.

`tests/chat-project-delete-oracle.test.ts` adds two comparator self-controls: valid
multi-author detach passes; nine shape-correct missing-chat, residual-grant,
unrelated-project, memory, personality, recency, metadata, attribution and undetached
reference losses reject at the oracle's `AssertionError`. They are self-controls,
not browser fault injection. Browser b is actual product-defect sensitivity evidence.

## Integrated verification and retrieval

Changed page inputs justified **20 fresh final executions**, all exit0:

| Surface | HTTP / actual Chromium |
|---|---|
| Delete v1.1 |9 /21 |
| Move v1.3 |8 /23 |
| Sharing v1.1 |11 /25 |
| Shutdown v1 |7 /31 |
| Terminal v1.4 |6 /47 |
| Selection v1 |6 /29 |
| Continuity v1 |7 /25 |
| Follow-up v1.2 |6 /29 |
| Project lifecycle v1.1 |8 /23 |
| Ask/turn |59 HTTP + six callbacks /33 |

Local gates: **suite144/144 (0 fail/skip/cancel), repo/delete types, docs validator
and10/10 controls PASS**. Skills lint passes with its two existing warnings;
consecutive manifest outputs and the pre-run manifest are byte-identical. Exact
logs/exits: App `output/chat-project-delete-20261003/local-checks.json` and
`skills-checks.json`; final input/receipt reconciliation: `integrated-verification.json`.
Dark EN/DE screenshots were also inspected at the actual UI surface.

From Chat, with owned TMPDIR and the existing launcher:
`node --import tsx scripts/chat-project-delete-journey.ts <fresh-output> <fresh-id> http|browser`.
Types: `node node_modules/typescript/bin/tsc --noEmit -p scripts/tsconfig.chat-project-delete.json`.
All exact invocations, process exits and log digests are retained in `*-command.json`.

App-relative entry **`output/chat-project-delete-20261003/`** retains:

- `start-inputs.json`, three dirty-tree status/diffs/revisions, full baseline runtime
  bytes, before-knowledge snapshots and tool/capacity identities;
- `frozen-gate-v1/`, `frozen-gate-v1.1/`, their manifests and per-run gate snapshots;
- `browser-{a,b}-diagnosis.json`, all failed raw receipts/observations, native dialog
  records, request/ack histories and screenshots;
- `candidate-inputs.json` / `candidate-page.tsx`, accepted `delete-http-b/`,
  `delete-browser-c/` and18 `integrated-<family>-<surface>/` stage receipts;
- `verify-evidence.mjs`: one-shot current-input/receipt audit, not a journey replay;
  final `integrated-verification.json` links/hash-checks all accepted stages and
  retained historical evidence. Additional `verified-inputs/` copies are explicitly
  post-execution byte retention after equality with executed manifests.

Scratch/profile base `/var/tmp/cortex-qa-tmp/project-delete-20261003/`; failed
`chat-journey-X3DD3R` and `chat-journey-iQcYmJ` retain source/SQLite/log/profile/private
dependencies/.next. Success removed only after receipt retention. Initial root~85GiB,
post-journey~82GiB free, RAM~11GiB available/swap~9GiB free; unchanged2GiB floor.
All prior diagnostics/archives and shared/unknown-owner resources remain untouched.
Prior697/145/134/133/190/225/144/109/87 evidence sets verified at resume, with all18
move-stage source/evaluator manifests reconciled read-only; historical IDs unchanged.

Actual Node22.22.3/Next16.1.7/React19.2.4/better-sqlite3-12.9.0 dev, external
Playwright-core1.63.0/Chromium153 revision1243; renderer2/JS512MiB launcher
`output/chat-project-terminal-20261002/diagnostic-chromium.sh` and stderr retained.
Clean app tripwires do not establish background-browser/OS-egress confinement.
No production Node20/Alpine, model-quality, deployment or reconstruction claim.
No commit/publication/live-store/paid calls; SDK/MCP inputs/contracts preserved.

## Harvest and next action

Owning streaming/storage/QA guides, all three checkpoints and public feature/handbook
source explain preservation and current-state acknowledgment ownership. Public source
labels the patch unreleased; portable playbook remainsv2.11.0. Fixture reuse was
exercised; overall future-change cost reduction remains a hypothesis.

**Next bounded action:** freeze a project DELETE transport failure **before server
dispatch/commit**, using an owned interception that genuinely fails the request.
With a selected project chat, require exact unchanged storage and direct no-refetch
edit/regenerate context/recall, plus successful-delete and cancel healthy controls.
Judge rejection propagation separately from the successful delayed-ack rule; only
fix after a frozen positive value rejection. Remote deletion of a selected non-author
chat, non-author in-flight persistence after detachment, instantaneous active-feed
revocation, overlapping moves and production parity remain separate schedules/decisions.
