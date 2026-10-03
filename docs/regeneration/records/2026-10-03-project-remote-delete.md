# Remote project deletion / selected author work / authority — 2026-10-03

Checkpoint **`chat-project-remote-delete-20261003-b`**, translate / playbook
**v2.12.0**, resumes **`chat-project-delete-rejection-20261003-b`**. App `bd6c1e0`,
Chat `40fe797`, Skills `1156ade`; dirty work preserved. Frozen **v1.1 HTTP10/10,
actual Chromium31/31 PASS**. Runtime delta only Chat `src/app/page.tsx`'s existing
list-refresh callback: select personal context when the live selected author's chat
appears in the authoritative personal flat list. History/recall are not reloaded.

## Intent, boundary and authority

Remote project removal keeps every author's chat and changes only its association.
The removed project/grants disappear, affected `project_id`s become NULL; all other
raw session/message fields, metadata/citation sid, personality, pin, opaque memory,
authorship and timestamps remain exact. Unrelated projects/chats remain unchanged.
The container owner does not gain access to someone else's detached chat.

Two independent member-author cases hold compaction after visible completion while
the project owner deletes through the real native confirm in a different browser
context. The selected URL/history remain; the author's chat enters its own flat
list. Valid late history/blob save remains eligible under full-snapshot LWW. Direct
changed-rating feedback consumes the selected pair; direct regenerate/edit-last
replay the immutable pre-turn memory, exact prefix, retained personality and personal
context without a repairing consumer chat GET. External HTTP/readonly SQLite reads
are observations, never inputs injected into the page being judged.

Authority is evaluated separately per effect:

| Effect after detach | Executed observation |
|---|---|
| Author new read/feed and valid pending persistence |200; exact author state/late memory retained |
| Former non-author new read/save/feed |404; rejected write leaves complete raw state unchanged |
| Non-author ask admitted before deletion |Original context/response/relay continues through later tokens and completion |
| That operation's new persistence PATCH |Actual browser404 with expected full attempted answer/blob; no storage change |
| Chat feed admitted before deletion |Receives post-detach author's settled change and admitted relay completion |
| New general ask with deleted optional project/session IDs |Caller-key200; deleted instructions/relay context omitted; local IDs stripped upstream |

Open-feed/ongoing-operation behavior is **observed**, not an instant-revocation or
non-author-persistence promise. Removing a sidebar row or rejecting a new feed does
not establish termination. No stronger lifecycle policy was inferred or implemented.

## Gate, healthy controls and diagnosis

`scripts/chat-project-remote-delete-{checks,journey}.ts`, types
`scripts/tsconfig.chat-project-remote-delete.json`, reuse the established isolated
real Next dev/migrated synthetic SQLite/crypto/held-loopback fixture. Two real form
logins use independent contexts in one existing owned Chromium process. Native DE
and EN cancel, exact unchanged storage/no mutation, healthy member direct redo,
actual feed readiness, acknowledged writes, every page's errors/crashes, unhandled
rejection, blocked app requests, complete required selection and response drain all
remain gates. Existing gates/helpers were not edited.

| Attempt | Verdict and classification |
|---|---|
| HTTP a, v1, unchanged runtime |10 selected/9 passed, exit1: evaluator demands literal `kind:"changed"`; actual settled event omits kind |
| Browser a, v1, unchanged runtime |31/29, exit1: exactly regenerate/edit context rejects deleted project IDs instead of NULL; all29 healthy/state/late-memory/authority/error controls pass |
| HTTP b, v1.1, unchanged runtime |10/10 PASS before runtime repair; corrected healthy authority observations established |
| Final browser b / HTTP c, v1.1 |31/31 and10/10 PASS against one combined candidate |

`GATE-CORRECTION.md` retains the supported optional-kind rule (`ChatEvent.kind`
absent means settled change), raw event evidence and separate freeze. v1.1 also
correlates author/event timestamp with the acknowledged write's SQLite `updated_at`
and exact memory. Browser driver/value bytes are identical between v1/v1.1; unused
HTTP logic and wrapper version label changed. The original browser context conjunct
rejects the baseline; its later snapshot clauses were not reached in that failed
row. Final v1.1 evaluates the entire conjunction. No gate bound/value was relaxed.

The smallest repair uses **positive author-only flat-list membership**, with the
existing live `activeSessionRef`, to clear just the selected project's context.
Project-list absence alone would conflate deletion with grant removal and would
not establish another author's association or rights. No new ref/state owner,
repairing chat GET, revision/CAS/protocol, schema/migration or dependency change.
Server full-snapshot LWW, opaque recall, stable request IDs and local snapshots remain.

## Integrated verification and retrieval

Changed page warranted **23 fresh final runtime executions**, all exit0:
remote HTTP10/Chromium31; rejection Chromium23; successful delete9/21, move8/23,
sharing11/25, shutdown7/31, terminal6/47, selection6/29, continuity7/25, follow-up6/29,
project8/23, ask59 HTTP + six positive callback gates /Chromium33.
Suite **147/147 (0 fail/skip/cancel)**, repo/remote types, App docs validator and
10/10 controls PASS. Skills lint passes with its two existing warnings; manifest
before/first/second generations match byte-for-byte. Dark EN settled and DE cancel
screenshots were inspected. Counts/exits/digests are co-retained, not inferred from
captured requests. Final audit: App
`output/chat-project-remote-delete-20261003/integrated-verification.json`.

From Chat with owned root-backed `TMPDIR` and the recorded launcher:
`node --import tsx scripts/chat-project-remote-delete-journey.ts <fresh-output> <fresh-id> http|browser`.
Types: `node node_modules/typescript/bin/tsc --noEmit -p scripts/tsconfig.chat-project-remote-delete.json`.
App `output/chat-project-remote-delete-20261003/campaign.mjs` records all actual
invocations/exit statuses/log hashes in `*-command.json`, refuses historical IDs,
and preserves before-knowledge/full baseline runtime and both frozen gate versions.

The App-relative evidence entry above retains all raw failed/final receipts, request/
acknowledgment histories, native dialogs, HTTP feed events, raw before/after state,
consumer/upstream bodies, screenshots, candidate bytes, local receipts and
`verify-evidence.mjs`. Executed evaluator bytes are retained in each gate snapshot;
`verified-inputs/` copies are post-execution retention after equality to execution
hashes. Audit is evidence/current-input validation, not another behavioral replay.
Prior rejection891/delete905/move697 and earlier evidence sets remain retrievable;
all historical source/gate verdicts and diagnostic archives are preserved read-only.

Owned root-backed base `/var/tmp/cortex-qa-tmp/project-remote-delete-20261003/`
retains failed **`chat-journey-7tUWNI`** (HTTP adapter) and **`chat-journey-qXWoVG`**
(browser product rejection), including source/SQLite/log/private dependencies/.next
and browser profile diagnostics where created. Successful scratch was removed only
after actual receipt retention. Root~81GiB initially/~79GiB after verification,
RAM~13GiB available/swap~9GiB free; unchanged2GiB floor remains. Shared/unknown-owner
resources and all earlier failed scratch remain untouched.

Actual Node22.22.3/Next16.1.7/React19.2.4/better-sqlite3-12.9.0 dev runtime;
external Playwright-core1.63.0/Chromium153 revision1243, existing renderer2/JS512MiB
launcher `output/chat-project-terminal-20261002/diagnostic-chromium.sh`, stderr
retained, no installs. Clean app tripwires do not establish browser-background/OS
egress confinement. No production Node20/Alpine, live store/model quality,
replacement/reconstruction, deployment/publication or commit claim.

## Harvest and precise next action

Owning streaming/storage/QA guides, public feature/handbook source (patch labeled
unreleased), and all three checkpoints updated. Portable guidance staysv2.12.0;
its existing ownership/admission/failure rules apply. Fixture reuse was exercised;
overall future-change cost reduction remains a hypothesis.

**Next bounded action:** freeze genuine delayed **personal flat-list** responses
across an acknowledged own-chat move into a shared project, including a response
requested before navigation to a different selected project chat. Deliver the old
list after move/current selection settles; direct edit/regenerate must retain the
current acknowledged association, exact history/recall/personality and immutable
snapshot without a repairing chat GET. Include healthy current-list/remote-delete
controls and freeze the supported response-order/ownership rule before fixes.
This tests freshness of the association evidence used here; it is not yet covered.
Uncertain post-dispatch DELETE response loss, stronger non-author lifecycle policy,
overlapping moves and production parity remain separate schedules/decisions.
