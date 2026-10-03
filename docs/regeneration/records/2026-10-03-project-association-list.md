# Association-list freshness / request and view ownership — 2026-10-03

Checkpoint **`chat-project-association-list-20261003-c`**, translate / playbook
**v2.12.0**, resumes **`chat-project-remote-delete-20261003-b`**. App `bd6c1e0`,
Chat `40fe797`, Skills `1156ade`; dirty work preserved. Frozen **v1.1 Chromium27/27
PASS**. Runtime delta only Chat `src/app/page.tsx`: existing sidebar refresh now
has page-local latest-request ownership, and association-driven context changes
also require the dispatch-time selected session/view to remain current.

## Intent and frozen boundary

A genuine older personal-list response is stale association evidence after a move,
even though the chat and its author retain the same IDs. It must not clear the
acknowledged or freshly loaded project context. Keep exact origin history/metadata/
citation sid, personality, authorship, timestamps and opaque memory. Preserve valid
late compaction and local immutable edit/regenerate snapshots; no repairing chat
GET may conceal a lost selected context. Sidebar refresh and selected-view changes
have distinct owners: global lists can refresh without rebinding another view.

Gate `scripts/chat-project-association-list-{checks,journey}.ts`, types
`scripts/tsconfig.chat-project-association-list.json`, reuse the isolated real Next
dev/migrated synthetic SQLite/crypto/held-loopback/Chromium fixture. One actual
owner form login plus a real HTTP member login supplies an independently owned
shared target and notifications. All external HTTP/readonly SQLite reads observe
state only; held responses preserve actual producer bytes.

- Healthy dark DE/EN, native shared-move consent, full raw move-only state, current
  direct context and settled persistence. Healthy remote owner deletion explicitly
  detaches all authors' rows and current direct redo uses personal context.
- **Move schedule:** a local done-visible turn holds compaction in a personal chat.
  Capture its actual personal-list response; native drag/consent move succeeds, a
  newer real list completes without that chat, then deliver the older response.
- **Navigation schedule:** retain a done-visible local turn for another personal
  chat, switch to the source via sidebar, and capture a list containing the other
  chat. A real author PATCH moves the other chat; selecting it through the same
  mounted sidebar loads its current project association and retained local snapshot.
  Deliver the old list while it is still the **latest requested list**. This isolates
  view ownership from request ordering; a request-only guard is insufficient.
- Each case checks actual delivery/selection/current raw association, valid late
  compaction, changed-rating feedback and direct regenerate/edit. The immutable
  memory/prefix/personality/no-GET clauses precede the context comparison, so baseline
  rejection is specifically loss of project context, not inferred snapshot loss.
- All attempted browser PATCHes require200 acknowledgments; page/crash/unhandled/
  app-tripwire, complete selection, source/dependency drift, response drain and
  actual receipt retention remain gates. Driver sequence/refresh counts identify
  these particular schedules, not a replacement's public refresh-count obligation.

## Attempts, correction and smallest patch

| Attempt | Executed verdict |
|---|---|
| Browser a, v1, unchanged runtime |12 selected/10 passed, exit1/incomplete; auxiliary memory-only PATCH publishes chat event, not project/sidebar event, so no list is captured; dependent drain/selection fail |
| Browser b, v1.1, unchanged runtime |27/25, exit1; exactly move/navigation direct context fails with NULL instead of current project; all25 healthy/state/late-memory/immutable/error controls pass |
| Browser c, v1.1, candidate |27/27 PASS, exit0 |

`GATE-CORRECTION.md` preserves the unsupported-trigger failure. v1.1 uses the
signal chat's independently seeded full messages plus new opaque memory, through
the same actual acknowledged member PATCH, which publishes the supported project
event. Only that auxiliary fixture chat changes. No value/bound/shared helper was
weakened; the revised gate ran on unchanged runtime before any product repair.

Small page-only repair:

1. One page-local request counter covers the existing flat-list/project-list refresh.
   Older flat responses return before applying state; project results apply only
   while their request remains latest. No persistent revision/CAS or protocol change.
2. Capture `viewRef` and selected session at dispatch. Positive flat-list membership
   can clear context only if both still match after await. Global list updates are
   separate from this selected-view projection, so ordinary initial sidebar loading
   still works while a chat load changes views.

Remote-delete positive association evidence remains valid; no new chat GET,
history/recall rewrite, schema/migration/dependency change, App/SDK/MCP runtime delta,
or new lifecycle policy. Server full-snapshot LWW, opaque state and stable IDs kept.
The gate holds flat-list responses; it does not separately hold every project-list
response ordering or claim production/multi-replica behavior.

## Integrated evidence and retrieval

Changed page warranted **24 fresh final runtime executions**, all exit0:
association Chromium27; remote HTTP10/Chromium31; rejection Chromium23; delete9/21,
move8/23, sharing11/25, shutdown7/31, terminal6/47, selection6/29, continuity7/25,
follow-up6/29, project8/23, ask59 HTTP + six positive callbacks /Chromium33.
Local **suite147/147,0 fail/skip/cancel**, repo/association types, App docs validator
and10/10 controls PASS. Skills lint passes with two existing warnings; manifest
before/first/second bytes match. Dark DE and EN settled screenshots inspected.

App-relative entry **`output/chat-project-association-list-20261003/`** retains
before-knowledge/full baseline runtime, both frozen gate versions, candidate page
and manifests, original failure diagnoses, raw requests/acks/native dialogs/list
capture+delivery schedules/state/consumer bodies/screenshots, all24 final receipts,
local results and the one-shot `verify-evidence.mjs` /
`integrated-verification.json`. `verified-inputs/` copies are explicitly post-execution
byte retention after equality to the executed manifest, not new runs.

From Chat, owned root-backed TMPDIR and existing recorded launcher:
`node --import tsx scripts/chat-project-association-list-journey.ts <fresh-output> <fresh-id>`.
Types: `node node_modules/typescript/bin/tsc --noEmit -p scripts/tsconfig.chat-project-association-list.json`.
Owned `campaign.mjs` retains actual commands/exits/log hashes in `*-command.json`.
The final audit validates required selections, identical candidate manifests,
complete receipts, current inputs and old evidence read-only; it is not a journey
replay. Historical remote1003/rejection891/delete905/move697 and earlier evidence
sets, executed gates and original verdicts remain intact and retrievable.

Owned base `/var/tmp/cortex-qa-tmp/project-association-list-20261003/` retains
**`chat-journey-BGZXZc`** (failed trigger) and **`chat-journey-DyxLfl`** (product
baseline), including source/SQLite/log/private dependencies/.next/browser diagnostics.
Success removed only after actual receipt retention. Root~79GiB initially/~77GiB
after checks, RAM~13GiB available/swap~9GiB free; unchanged2GiB floor preserved.
All earlier failed scratch/shared/unknown-owner resources untouched.

Actual Node22.22.3/Next16.1.7/React19.2.4/better-sqlite3-12.9.0 dev;
existing external Playwright-core1.63.0/Chromium153 revision1243, renderer2/JS512MiB
launcher `output/chat-project-terminal-20261002/diagnostic-chromium.sh`, root-backed
profiles/stderr, no installs. Clean app hooks do not prove browser-background/OS
egress confinement. No commit/deployment/publication/live-store/paid call, production
Node20/Alpine, model-quality, replacement/reconstruction or release-ready claim.

## Harvest and next remaining action

Owning streaming/storage/QA guides, three-repo checkpoints and public feature/
handbook source (unreleased candidate) updated. Portable guidance staysv2.12.0;
existing request/view ownership and actual notification/consumer rules apply.
Fixture reuse exercised; total future-change cost saving remains a hypothesis.

**Next bounded action:** freeze actual **post-dispatch DELETE response loss**.
With an author's selected done-visible chat and held compaction, forward the real
native-confirm DELETE, retain its authoritative committed detach/healthy server-log
evidence, then fail delivery of its genuine response to the caller. Keep known
pre-dispatch rejection and acknowledged success controls separate. Judge caller
failure, authoritative state, supported list reconciliation/current direct consumers,
valid late memory and absence of automatic DELETE replay independently. Do not infer
rollback from no acknowledgment or label this as a pre-dispatch failure. Freeze
healthy exact-state/immutable consumers before any runtime repair. Stronger non-author
revocation policy, overlapping moves and production parity remain separate.
