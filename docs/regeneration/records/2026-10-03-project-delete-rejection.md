# Project DELETE rejection / direct consumers — 2026-10-03

Checkpoint **`chat-project-delete-rejection-20261003-b`**, translate / playbook
**v2.11.0**, resumes **`chat-project-delete-20261003-c`**. App `bd6c1e0`, Chat
`40fe797`, skills `1156ade`; dirty work preserved. Frozen **Chromium23/23 v1 PASS**;
runtime delta only Chat `src/app/page.tsx`'s rejected-delete early return.

## Intent and frozen boundary

A DELETE that fails before dispatch cannot detach a chat or select a detached
project context. Preserve exact projects, grants, every author's sessions/messages,
personality, pin, opaque recall, metadata/citation sid, attribution and timestamps.
Valid held origin compaction remains eligible; direct regenerate/edit use the
immutable pre-turn snapshot and retained project instructions. Success remains a
separate effect: explicit detach and the current-state acknowledgment rule from c.

`projects-client.ts` already throws transport and non-success HTTP results. The page
swallowed that rejection and continued through its successful-delete context update.
No new state owner/CAS/schema/migration/dependency or SDK/MCP/App runtime change.

Gate `scripts/chat-project-delete-rejection-{checks,journey}.ts`, types
`scripts/tsconfig.chat-project-delete-rejection.json`; existing isolated real Next
dev/SQLite/crypto/migrations/held-loopback/Chromium fixture. One real synthetic owner
form login; member login/seeding through real HTTP establishes a second chat author.
No live data/model calls. External HTTP/read-only SQLite observations never repair
the selected browser state. Existing gates/helpers stay byte-identical.

- Dark DE/EN native cancel controls, exact existing confirmation text, no mutation.
  Direct regenerate after cancel retains the project, personality and stored fallback.
- Two independent own-chat cases, one direct regenerate and one edit-last: actual
  `route.abort("failed")` intercepts DELETE **before fetch/continue**. Require browser
  `requestfailed` with `net::ERR_FAILED`, no response acknowledgment, no matching
  server DELETE log and exact raw project/share/session/message equality.
- Current page's post-failure project-list response and two animation frames delimit
  committed callback/view observation. They are adapter scheduling, not a replacement
  refresh-count requirement. Reads of chat state are observations outside the page.
- Each own turn is done-visible with late compaction held across rejected deletion;
  its exact originating history/opaque blob remains durable. Direct redo then consumes
  retained project instructions, original pre-turn memory, exact prefix and personality
  without a repairing browser chat GET while held, and settles inside the same project.
- Healthy actual successful native delete detaches both authors' chats exactly and
  appears200 in the **same** server log, then direct regenerate uses personal context.
- Every browser DELETE/PATCH is accounted for: exactly two independently identified
  expected transport failures; all other writes have real200 acknowledgments. Complete
  selection, page errors/crashes, unhandled rejection, blocked app requests, response
  drain, input drift and receipt/cleanup gates remain required. Network console
  errors from the deliberate abort are retained diagnostics, not blanket exemptions.

This gate proves **known pre-dispatch no-commit** failure. It does not prove rollback
when a response is lost after dispatch/commit, remote deletion's selected-view
lifecycle, instantaneous active-feed revoke, or non-author in-flight save semantics.

## Baseline and smallest patch

First frozen browser **a23/21, exit1** rejects exactly
`browser.regenerate-consumer-context` and `browser.edit-consumer-context`: actual
`project_id:null` instead of each still-existing selected project. All21 other
healthy, transport, state, late-memory, acknowledgment/error/selection/drain rows
pass. No evaluator correction was required. The immutable-snapshot clauses after
each failed context comparison were not reached in a; b evaluates the whole frozen
conjunction. Original receipt, source/gate bytes, raw requests, logs and scratch retained.

Patch: replace `.catch(() => {})` fallthrough with `try/await/catch`, refresh lists
and return on rejection. Keep c's pure current-state comparison after success.
No new ref/controller, repairing chat GET, error banner or protocol. Frozen browser
**b23/23, exit0** accepts the candidate.

`tests/chat-project-delete-client.test.ts`: three public-boundary tests freeze
successful DELETE acknowledgment,403/404/500 rejection and transport rejection with
no replay. All3 pass against unchanged client before page repair; this demonstrates
the rejection arrives at the page boundary, not a new client fix or browser fault
injection claim for those HTTP statuses.

## Integrated verification and evidence

Changed page justified **21 fresh final runtime executions**, all exit0:
rejection Chromium23; established delete HTTP9/Chromium21, move8/23, sharing11/25,
shutdown7/31, terminal6/47, selection6/29, continuity7/25, follow-up6/29, project8/23,
ask59 HTTP +six callbacks/Chromium33. Full final input/receipt reconciliation is in
App `output/chat-project-delete-rejection-20261003/integrated-verification.json`.
Local **suite147/147 (0 fail/skip/cancel), repo/rejection types, docs validator and
10/10 controls PASS**. Skills lint passes with its two existing warnings; manifest
before/first/second bytes match. Exact local receipts: `local-checks.json` and
`skills-checks.json`. Dark DE and EN settled-consumer screenshots were inspected.

Replay from Chat, owned root-backed TMPDIR and recorded launcher:
`node --import tsx scripts/chat-project-delete-rejection-journey.ts <fresh-output> <fresh-id>`.
Types: `node node_modules/typescript/bin/tsc --noEmit -p scripts/tsconfig.chat-project-delete-rejection.json`.
Every invocation/exit/log digest is retained in `*-command.json`.

App-relative entry **`output/chat-project-delete-rejection-20261003/`** retains:

- `start-inputs.json`, three status/diff/revision snapshots, full baseline runtime
  bytes and before-knowledge snapshots, tools and capacity;
- `frozen-gate-v1/` + manifest and per-run gate snapshots; client test bytes/results;
- `browser-a-diagnosis.json`, failed/final raw wrapper receipts, native dialogs,
  attempted writes/acks/expected failures, actual upstream/consumer requests,
  server logs, screenshots and `browser/rejection-observations.json`;
- `candidate-inputs.json`/`candidate-page.tsx`, accepted `rejection-browser-b/` plus
  all20 `integrated-<family>-<surface>/` receipts;
- `verify-evidence.mjs`: one-shot current-input/receipt audit, not journey replay;
  `verified-inputs/` copies are post-execution byte retention after equality to
  executed manifests. Original c/move/b/D/K and all failure verdicts remain intact.

Owned scratch/profile base `/var/tmp/cortex-qa-tmp/project-delete-rejection-20261003/`;
failed **`chat-journey-W3hNlA`** retains source/SQLite/log/profile/private graph/.next.
Successful scratch removed only after receipt retention. Initial root~82GiB free,
post-journey~81GiB, RAM~11GiB available/swap~9GiB free; unchanged2GiB floor retained.
All prior failed diagnostics/archives and shared/unknown-owner resources untouched.
Prior905/697/145/134/133/190/225/144/109/87 evidence sets and c's20 source/evaluator
manifests reconciled read-only at resume; final audit checks continued preservation.

Actual Node22.22.3/Next16.1.7/React19.2.4/better-sqlite3-12.9.0 development runtime,
external Playwright-core1.63.0/Chromium153 revision1243, existing renderer2/JS512MiB
launcher `output/chat-project-terminal-20261002/diagnostic-chromium.sh`. Stderr retained;
clean app tripwires do not establish browser-background/OS-egress confinement.
No commit/deploy/publication/live-store/paid calls, production/model-quality or
replacement/reconstruction claim. LWW, opaque state, stable IDs and snapshots kept.

## Harvest and next action

Owning streaming/storage/QA guidance, public feature/handbook source and three-repo
checkpoints updated; patch labeled unreleased. Portable playbook remainsv2.11.0;
existing failure/acknowledgment ownership rules cover this finding. Fixture reuse
exercised, total future-change cost saving still a hypothesis.

**Next bounded action:** freeze remote project deletion by its owner while another
member's own chat is selected/done-visible with compaction held. Require exact
author-owned detached state and valid late compaction, fresh author admission and
direct no-refetch selected-history/recall/context consumers. Add a separate non-author
selected-chat control: establish current read/save/feed rejection after detach and
extract ongoing-operation/open-feed semantics before specifying stronger lifecycle
behavior. Preserve cancel/success/rejection/late-ack gates; no instant-revocation or
non-author persistence promise inferred from author rights. Post-dispatch response
loss, overlapping moves and production parity remain separate scopes/decisions.

## Portable harvest after execution

Playbook **v2.12.0** generalizes delete c and rejection b at the existing owners:
§7.6 checks a healthy client's actual caller for swallowed rejection; §9.2
distinguishes known pre-dispatch no-commit from uncertain post-dispatch outcome and
requires healthy diagnostic-channel evidence; §9.5 covers actual native/localized
consent and fixture restoration; §9.6 reconciles identified expected transport
failures without suppressing unrelated runtime errors; §13.2 separates historical
detach pattern controls from actual handler compatibility; §13.3 protects retained
child ownership and pure current-state acknowledgment guards. §21 adds symptoms.

Current guide/three-repo continuation pointers usev2.12.0. **b's executedv2.11.0
basis and original body above**, all runtime/evaluator bytes, final21 results and
historical failures remain intact. This documentation-only harvest adds no journey,
production, reconstruction or instruction-autoload claim. Before-knowledge snapshots
and separate integrity/current-input/whitespace audit are App-relative:
`output/chat-project-delete-rejection-20261003/verify-playbook-harvest.mjs`,
`playbook-harvest-before.json` / `playbook-harvest-before/`, and
`playbook-harvest-verification.json`. The execution closeout remains immutable.
