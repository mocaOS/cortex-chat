# Turn/session-bound Chat callbacks — 2026-10-02

Mode **translate**, authorized page runtime fix. Checkpoint **`chat-ui-turn-bound-20261002-b`**.
**Actual Chromium browser: PASS (33/33). HTTP: PASS (59 checks + six positive
source-extracted callback gates).** Contract suite 129/129; repo and both script
typechecks passed. These are distinct boundaries, not 98 HTTP checks.

## Intent and preserved boundary

Late memory belongs to its originating turn/session. It must persist that turn's
settled history, never a subsequent partial answer or a different chat's list,
and must not replace the snapshot restored by regenerate/edit-last. Runtime
change is confined to `src/app/page.tsx`. Schemas, migrations, routes, dependencies
and dependency resolution remain unchanged. All three dirty trees preserved;
no commits/deployments/publication, live stores/production data or paid model calls.
App base `bd6c1e035b3e6ece7741a0b733bfd8735145f846`, Chat
`40fe79799c4729c4b695890566ef3a51746b3b5e`, skills `1156aded6726d6105cb13a72ded93efaf55f5bef`.

Preserved: `done` is visible completion without waiting for compaction; parser
continues reading; both SSE orders; opaque blobs and stable citation IDs;
regenerate/edit-last use the immutable at-send blob, earlier edits reset recall.
Server PATCH remains atomic full-snapshot **last-writer-wins**, with no CAS/revision
promise. This page serializes only its own writes per session.

Benefit demonstrated: D's fixture was reused to reproduce and fix a real follow-up
without rediscovering auth/SQLite/Next setup. Overall cost reduction remains
unmeasured; no replacement/reconstruction/release claim.

## Baseline and frozen acceptance

D (`chat-ask-memory-20261002-d`) and K were **not replayed**. D's receipt and raw
results remain intact. New browser baseline **`chat-browser-baseline-20261002-i`**
executed actual login/composer/actions/sidebar with held loopback SSE and isolated
synthetic SQLite/users. Execution 12/12, but all four page obligations **failed**.

| Scenario | Retained baseline | Final candidate |
|---|---|---|
| done → rapid next-send → old memory | partial next answer sent in PATCH and persisted; fresh browser page renders it as settled | old blob + origin settled prefix only; next turn still settles |
| done → regenerate → old memory | redo request has correct pre-turn blob, then superseded blob overwrites storage/ref and persists redo partial | restored blob stays intact; old callback ignored; redo settles |
| done → edit-last → old memory | same contamination via actual Edit → Save & send | snapshot isolation and fork semantics preserved |
| done → chat switch → old memory | origin PATCH carries foreign IDs; global message PK rejects it (500), silently losing origin memory | origin blob/history retained; foreign chat untouched; reload correct |
| healthy settled + legacy order | independent controls passed | controls passed, browser reload and verbatim next request replay |

Positive gates existed before implementation and rejected the baseline at intended
observable checks. `tests/fixtures/page-late-callback-baseline.ts` retains verbatim
defective expressions with immutable git-blob/hash provenance; seven deterministic
tests include healthy controls and four assertion-level rejections. Callback
probes now judge six **positive** gates through source extraction + real HTTP.
Extraction/binding/transport failures cannot count as behavioral rejection. Its
synchronous turn-creation/state/queue adapter is not React scheduling evidence;
the browser supplies the distinct actual-UI claim.

Candidate browser **a** failed a healthy-control observation: PATCH was captured
before commit, GET+SQLite still showed null. Receipt stays failed. The unchanged
exact-value gate now waits for committed GET+SQLite state. Review strengthened
switch memory from non-null to exact own-blob equality on both channels and added
required page-error/unhandled-rejection/selection checks. Baseline null observations
still reject the stronger gate. Read-only rejudgment:
`output/chat-gate-review-20261002/gate-review-rejudgment.json` (app-relative).
This is **not** a replay; retrospective hygiene inferences are separately labeled.

## Implementation and review

Each local turn captures session, view, own message snapshot and opaque memory.
Callbacks update that snapshot outside React updater functions; only the matching
current view renders/clears loading. Late memory persists an invisible origin.
Ordinary next-send permits predecessor compaction until a newer turn settles;
redo immediately supersedes the replaced chain. Newer settled snapshots supersede
predecessors. At-send memory is never changed retroactively.

Explicit completion/feedback persistence replaces the broad settle effect;
loading/remote adoption cannot write history back. FIFO page-local session writes
prevent earlier snapshots overtaking newer ones. Feedback stamps matching IDs in
pending snapshots; returning to an origin permits its own late memory to update
the session ref. Independent static review checked these rules and evaluator
honesty; final b runs used reviewed hashes. No UI styling/copy changed.

## Replay (existing tooling, fresh output/run IDs)

From `cortex-chat`, with root-backed existing `TMPDIR`:

```bash
TMPDIR=/var/tmp/cortex-qa-tmp npm test
TMPDIR=/var/tmp/cortex-qa-tmp npm run typecheck
TMPDIR=/var/tmp/cortex-qa-tmp node node_modules/typescript/bin/tsc --noEmit -p scripts/tsconfig.chat-journey.json
TMPDIR=/var/tmp/cortex-qa-tmp node node_modules/typescript/bin/tsc --noEmit -p scripts/tsconfig.chat-browser.json
TMPDIR=/var/tmp/cortex-qa-tmp node --import tsx scripts/chat-journey-checks.ts ../cortex-app/output/<fresh-http-id> <fresh-http-id>
TMPDIR=/var/tmp/cortex-qa-tmp node --import tsx scripts/chat-browser-journey.ts ../cortex-app/output/<fresh-browser-id> <fresh-browser-id> --mode candidate
```

Browser prerequisites: existing Playwright-core **1.63.0** at
`/home/clippy/coding/tixu-agent/node_modules/.pnpm/playwright-core@1.63.0/node_modules/playwright-core`
and cached Chromium **153.0.8010.12**, revision1243 executable
`/home/clippy/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`.
Override via `CHAT_BROWSER_PLAYWRIGHT_CORE` / `CHAT_BROWSER_CHROMIUM`; no installs
or lock changes. Missing paths fail before scratch creation. Browser loopback
request routing blocks external origins and dev HMR websocket (otherwise triggers
Next's lazy registry version check). Product HTTP/SSE is not replaced. Dark EN/DE
surfaces execute; locale flips only run-owned SQLite and is reversed. These and
Node tripwires are **not OS/native socket confinement**.

Runtime: Node22.22.3 / Next16.1.7 Turbopack `next dev`, React19.2.4,
better-sqlite3 12.9.0; private verbatim dependency copies, native smoke passed.
Not production Node20/Alpine, clean install/build, model quality or other browsers.
Project realtime/adoption, overlapping same-chat streaming rebase, demo, voice,
auth providers and broader browser lifecycle journeys remain uncovered.

## Retrievable evidence and identity

Paths are **cortex-app-relative**, readable local ignored artifacts, not off-host
backups or guaranteed long-term storage:

- Baseline: `output/chat-browser-baseline-20261002/chat-journey-chat-browser-baseline-20261002-i-2026-10-02T09-12-02-299Z/`.
- Final browser: `output/chat-ui-turn-bound-20261002-b/chat-journey-chat-ui-turn-bound-20261002-b-2026-10-02T09-44-15-050Z/`.
- Final HTTP: `output/chat-http-turn-bound-20261002-b/chat-journey-chat-http-turn-bound-20261002-b-2026-10-02T09-43-06-315Z/`.

Retain each `results.json`, `claim-verdicts.json`, app/tripwire logs and manifests.
Browser subtree retains full baseline/candidate page copies, observations, raw
requests/PATCH bodies, tooling manifest and screenshots. Browser runner augments
retained runtime results with browser scope/verdicts after cleanup; hashes below
address those final bytes. Both b runs exit0, zero drift/blocked attempts/errors;
owned servers stopped and scratch removed **after** actual evidence retention.
HTTP correctly labels browser not-run; the separate browser receipt accepts UI.

| Artifact | SHA-256 |
|---|---|
| baseline page / git blob `3e0926bc37824f0070161cf6426f9fd0a42602c8` | `6e5fbf5ab5d240662cd8f40ed02814124dd6918fde1c5e8c6ef6aa4d84eb9bb2` |
| candidate `src/app/page.tsx` | `7e70390e52d521a3a3802cdd065c27f0b72d25a46537db49a7121b674ab24e2d` |
| browser b results | `a7c9e88d0353f40d3bbd3d642a32c5666d4372e0c465fd4d907e760d23e9fc8e` |
| browser b verdicts | `723534f60c01cc4503cef1735cfa678a732bfc79e18f0b951db0c3f58babfef4` |
| HTTP b results | `8dbda5da67f61f2bfa5a85444fd0ede86cac605d3df747095a5fd048601b4971` |
| HTTP b verdicts | `dbd0077e6d9ca4e9b1099e21dab1707fa553b5e4b0a05ba72c674c1d44a37527` |
| browser checks / runner | `561637f0acc7da31309ef98cf3bc8589d8977f3cd3ee21256f8bba49a68e959a` / `1de844c98809720b8cd71b77b2745be6006a26f04785d5e641feec2e8a03d0d8` |
| positive callback probes / runner | `4272b806347307c2229180389f045f978d0f42682305c8ca65557433204856a7` / `c5535db172e02187ae9c7f93e42faae9d61f32a9d56a178ca3bcbdeef18a5766` |

Both b source manifests: `4852b4fd3b39f99ef1f5eb5e626ffb4bf5ac4c89f0c6e77164ab4eab791f6697`;
scenario hashes agree with current files. Runtime/ask/memory inputs and lock stay
D's bytes; D results hash remains `42b1474a65c2e4b77895b6677d85086565c05bb5e9335d3028e40392cce6dbf9`.

Closeout: `node output/chat-ui-turn-bound-20261002-b/verify-receipts.mjs` from app
passed; retained `integrated-verification.json` verifies both complete selections,
all consumed current runtime/evaluation file hashes, installed-lock identity,
final cleanup, zero drift/tripwire attempts, and intact D/browser-baseline digests.
This is read-only evidence rejudgment, not another journey execution.
All three `git diff --check` passed. App documentation `npm run validate` and
`TMPDIR=/var/tmp/cortex-qa-tmp npm test` passed (10/10). An initial docs test command
omitted TMPDIR and failed seven setup copies with ENOSPC on `/tmp`; corrected
environment passed without assertion/source changes. No shared scratch was pruned.
Other app/SDK/MCP runtime suites were not rerun: their inputs are unchanged and
there is no new execution claim for them.

## Resource handoff and next action

`/tmp` still ~2MiB free; root scratch had 38GiB initially, ~22GiB at close. Do not
globally clean scratch or operate shared Podman; K's unknown-owner constraints
remain binding. Retained failed scratch under `/var/tmp/cortex-qa-tmp/`:
baseline `chat-journey-{BdBVAy,CTuuT8,5cxX1Z,qruQ4c,vBO1Jh,GSRFaU,ZMZpmE,2E5O76}`;
callback smoke `{CRJ8xn,THAZWj,rOETTh,MmzUCY,j3StzE,0KUV5A}`;
candidate browser a `chat-journey-WI5ajd`. Verify exact ownership and required
diagnostics before removal. D's `96HH28`/`BIbZLs` untouched. Successful b and
successful smoke scratch removed; an earlier tool report alone cannot prove retention.

Next: reuse the browser fixture for **shared project-chat rebase/adoption with
overlapping streams and switch-away/back**. Freeze full-snapshot LWW expectations
and controls first; inspect loading/remote-adoption timing before any runtime
change. Production Node20/Alpine requires a separately identified owned environment.
Do not replay K, D or b without changed relevant inputs or a new evidence claim.
